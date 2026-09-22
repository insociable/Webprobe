import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { scanArtifacts, scans } from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { db } from "./database";
import {
  getSiteForOrganization,
  requireOrganizationAccess,
} from "./organization-site-service";

export type PrimaryScreenshotArtifact = {
  storageKey: string;
  mediaType: "image/jpeg";
  byteSize: number;
  sha256: string;
};

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

function resolveStorageKey(storageKey: string): string | null {
  if (
    !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/primary\.jpg$/i.test(
      storageKey,
    )
  ) {
    return null;
  }

  const root = artifactRoot();
  const resolved = path.resolve(root, ...storageKey.split("/"));
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  return resolved.startsWith(prefix) ? resolved : null;
}

export async function getPrimaryScreenshotArtifactForScope(
  organizationId: string,
  siteId: string,
  scanId: string,
): Promise<PrimaryScreenshotArtifact | null> {
  const [artifact] = await db
    .select({
      storageKey: scanArtifacts.storageKey,
      mediaType: scanArtifacts.mediaType,
      byteSize: scanArtifacts.byteSize,
      sha256: scanArtifacts.sha256,
    })
    .from(scanArtifacts)
    .innerJoin(
      scans,
      and(
        eq(scanArtifacts.scanId, scans.id),
        eq(scanArtifacts.organizationId, scans.organizationId),
        eq(scanArtifacts.siteId, scans.siteId),
      ),
    )
    .where(
      and(
        eq(scanArtifacts.organizationId, organizationId),
        eq(scanArtifacts.siteId, siteId),
        eq(scanArtifacts.scanId, scanId),
        eq(scanArtifacts.kind, "primary-screenshot"),
        eq(scans.status, "completed"),
      ),
    )
    .limit(1);

  if (!artifact || artifact.mediaType !== "image/jpeg") {
    return null;
  }

  return {
    storageKey: artifact.storageKey,
    mediaType: "image/jpeg",
    byteSize: artifact.byteSize,
    sha256: artifact.sha256,
  };
}

export async function readPrimaryScreenshot(
  artifact: PrimaryScreenshotArtifact,
): Promise<Buffer | null> {
  const filePath = resolveStorageKey(artifact.storageKey);
  if (
    !filePath ||
    artifact.byteSize <= 0 ||
    artifact.byteSize > 2 * 1024 * 1024
  ) {
    return null;
  }

  try {
    const data = await readFile(/* turbopackIgnore: true */ filePath);
    if (data.length !== artifact.byteSize) {
      return null;
    }

    const digest = createHash("sha256").update(data).digest("hex");
    return digest === artifact.sha256 ? data : null;
  } catch {
    return null;
  }
}

export async function getPrimaryScreenshotArtifact(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
): Promise<PrimaryScreenshotArtifact | null> {
  await requireOrganizationAccess(userId, organizationId);
  const site = await getSiteForOrganization(userId, organizationId, siteId);
  if (!site) {
    return null;
  }

  return getPrimaryScreenshotArtifactForScope(organizationId, siteId, scanId);
}
