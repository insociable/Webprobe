import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanArtifacts } from "@agency-saas/db";
import { getDatabase } from "./database.js";
import type { BrowserScreenshot } from "./browser-scan.js";

const maxScreenshotBytes = 2 * 1024 * 1024;

export function scanArtifactStorageRoot(): string {
  const configured = process.env.SCAN_ARTIFACTS_DIR?.trim();
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  return path.resolve(repositoryRoot, configured || "storage/scan-artifacts");
}

function assertUuidSegment(value: string, label: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`Invalid ${label} for artifact storage`);
  }
}

export function primaryScreenshotStorageKey(input: {
  organizationId: string;
  siteId: string;
  scanId: string;
}): string {
  assertUuidSegment(input.organizationId, "organizationId");
  assertUuidSegment(input.siteId, "siteId");
  assertUuidSegment(input.scanId, "scanId");

  return path.posix.join(
    input.organizationId,
    input.siteId,
    input.scanId,
    "primary.jpg",
  );
}

function artifactPath(storageKey: string): string {
  const root = scanArtifactStorageRoot();
  const resolved = path.resolve(root, ...storageKey.split("/"));
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (!resolved.startsWith(prefix)) {
    throw new Error("Artifact path escaped storage root");
  }

  return resolved;
}

export async function persistPrimaryScreenshot(input: {
  organizationId: string;
  siteId: string;
  scanId: string;
  screenshot: BrowserScreenshot;
}): Promise<boolean> {
  if (
    input.screenshot.mediaType !== "image/jpeg" ||
    input.screenshot.data.length === 0 ||
    input.screenshot.data.length > maxScreenshotBytes
  ) {
    return false;
  }

  const storageKey = primaryScreenshotStorageKey(input);
  const targetPath = artifactPath(storageKey);
  const targetDirectory = path.dirname(targetPath);
  const temporaryPath = path.join(
    targetDirectory,
    `.primary-${randomUUID()}.tmp`,
  );

  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });

  try {
    await writeFile(temporaryPath, input.screenshot.data, { mode: 0o600 });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  const sha256 = createHash("sha256")
    .update(input.screenshot.data)
    .digest("hex");
  const { db } = getDatabase();

  await db
    .insert(scanArtifacts)
    .values({
      organizationId: input.organizationId,
      siteId: input.siteId,
      scanId: input.scanId,
      kind: "primary-screenshot",
      storageKey,
      mediaType: input.screenshot.mediaType,
      byteSize: input.screenshot.data.length,
      sha256,
    })
    .onConflictDoUpdate({
      target: [scanArtifacts.scanId, scanArtifacts.kind],
      set: {
        organizationId: input.organizationId,
        siteId: input.siteId,
        storageKey,
        mediaType: input.screenshot.mediaType,
        byteSize: input.screenshot.data.length,
        sha256,
        createdAt: new Date(),
      },
    });

  return true;
}
