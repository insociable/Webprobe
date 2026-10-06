import {
  artifactCleanupTasks,
  scanArtifacts,
  scanSchedules,
  scans,
  sites,
} from "@agency-saas/db";
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

function validSiteArtifactKey(
  storageKey: string,
  organizationId: string,
  siteId: string,
): boolean {
  const segments = storageKey.split("/");
  return (
    segments.length === 4 &&
    segments[0]?.toLowerCase() === organizationId.toLowerCase() &&
    segments[1]?.toLowerCase() === siteId.toLowerCase() &&
    segments.slice(0, 3).every((segment) => uuidPattern.test(segment)) &&
    segments[3] === "primary.jpg"
  );
}

export type SiteDeletionResult = {
  deleted: boolean;
  artifactCleanupPending: number;
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

  const artifactCount = await db.transaction(async (tx) => {
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

    for (const artifact of artifacts) {
      if (!validSiteArtifactKey(artifact.storageKey, organizationId, siteId)) {
        throw new SiteDeletionError(
          "Site artifact storage key is invalid",
          "artifact-invalid",
        );
      }
    }

    // No task can become visible until both the deletion and the outbox
    // commit. The worker keeps it until unlink succeeds (including ENOENT).
    if (artifacts.length > 0) {
      await tx
        .insert(artifactCleanupTasks)
        .values(artifacts)
        .onConflictDoNothing({
          target: artifactCleanupTasks.storageKey,
        });
    }

    const deleted = await tx
      .delete(sites)
      .where(
        and(eq(sites.id, siteId), eq(sites.organizationId, organizationId)),
      )
      .returning({ id: sites.id });

    if (deleted.length !== 1) {
      throw new SiteDeletionError("Site not found", "site-not-found");
    }

    return artifacts.length;
  });

  return { deleted: true, artifactCleanupPending: artifactCount };
}
