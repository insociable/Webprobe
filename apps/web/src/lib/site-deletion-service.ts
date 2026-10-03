import { unlink } from "node:fs/promises";
import path from "node:path";
import { scanArtifacts, scanSchedules, scans, sites } from "@agency-saas/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  getOrganizationAccess,
  OrganizationAccessError,
} from "./organization-site-service";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SiteDeletionError extends Error {
  constructor(
    message: string,
    readonly code: "site-not-found" | "scan-active" | "artifact-invalid",
  ) {
    super(message);
    this.name = "SiteDeletionError";
  }
}

function repositoryRootFromCwd(): string {
  const cwd = process.cwd();
  return path.basename(path.dirname(cwd)) === "apps"
    ? path.resolve(cwd, "../..")
    : cwd;
}

function artifactRoot(): string {
  const configured = process.env.SCAN_ARTIFACTS_DIR?.trim();
  if (configured && path.isAbsolute(configured)) {
    return configured;
  }

  return path.resolve(
    /* turbopackIgnore: true */ repositoryRootFromCwd(),
    configured || "storage/scan-artifacts",
  );
}

function resolveSiteArtifactPath(
  storageKey: string,
  organizationId: string,
  siteId: string,
): string | null {
  const segments = storageKey.split("/");
  if (
    segments.length !== 4 ||
    segments[0]?.toLowerCase() !== organizationId.toLowerCase() ||
    segments[1]?.toLowerCase() !== siteId.toLowerCase() ||
    !segments[2] ||
    !uuidPattern.test(segments[2]) ||
    segments[3] !== "primary.jpg"
  ) {
    return null;
  }

  const root = artifactRoot();
  const resolved = path.resolve(root, ...segments);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return resolved.startsWith(prefix) ? resolved : null;
}

async function removeArtifact(filePath: string): Promise<void> {
  try {
    await unlink(/* turbopackIgnore: true */ filePath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

export type SiteDeletionResult = {
  deleted: boolean;
  artifactCleanupFailures: number;
};

export async function deleteSiteForOrganization(
  userId: string,
  organizationId: string,
  siteId: string,
): Promise<SiteDeletionResult> {
  const access = await getOrganizationAccess(userId, organizationId);
  if (!access) {
    throw new OrganizationAccessError();
  }
  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only organization owners and admins can delete sites",
    );
  }

  const artifactPaths = await db.transaction(async (tx) => {
    // Keep the same lock namespace as manual scans. Scheduled scans are
    // fenced by locking the site row before this transaction checks activity.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`manual-scan:site:${siteId}`}, 0))`,
    );

    // The scheduler locks schedule rows before inserting a scan. Taking the
    // same lock order prevents a delete/schedule race from deadlocking while
    // PostgreSQL cascades the site deletion.
    await tx
      .select({ id: scanSchedules.id })
      .from(scanSchedules)
      .where(eq(scanSchedules.siteId, siteId))
      .for("update");

    const [site] = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(
        and(eq(sites.id, siteId), eq(sites.organizationId, organizationId)),
      )
      .for("update")
      .limit(1);

    if (!site) {
      throw new SiteDeletionError("Site not found", "site-not-found");
    }

    const [activeScan] = await tx
      .select({ id: scans.id })
      .from(scans)
      .where(
        and(
          eq(scans.siteId, siteId),
          inArray(scans.status, ["queued", "running"]),
        ),
      )
      .limit(1);

    if (activeScan) {
      throw new SiteDeletionError(
        "A scan is still running for this site",
        "scan-active",
      );
    }

    const artifacts = await tx
      .select({ storageKey: scanArtifacts.storageKey })
      .from(scanArtifacts)
      .where(eq(scanArtifacts.siteId, siteId));

    const paths = artifacts.map(({ storageKey }) => {
      const resolved = resolveSiteArtifactPath(
        storageKey,
        organizationId,
        siteId,
      );
      if (!resolved) {
        throw new SiteDeletionError(
          "Site artifact storage key is invalid",
          "artifact-invalid",
        );
      }
      return resolved;
    });

    const deleted = await tx
      .delete(sites)
      .where(
        and(eq(sites.id, siteId), eq(sites.organizationId, organizationId)),
      )
      .returning({ id: sites.id });

    if (deleted.length !== 1) {
      throw new SiteDeletionError("Site not found", "site-not-found");
    }

    return paths;
  });

  let artifactCleanupFailures = 0;
  for (const filePath of artifactPaths) {
    try {
      await removeArtifact(filePath);
    } catch (error) {
      artifactCleanupFailures += 1;
      console.error("Site artifact cleanup failed", {
        filePath,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return { deleted: true, artifactCleanupFailures };
}
