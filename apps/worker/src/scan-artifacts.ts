import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactCleanupTasks,
  scanArtifacts,
  scans,
  sites,
} from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "./database.js";
import type { BrowserScreenshot } from "./browser-scan.js";

const maxScreenshotBytes = 2 * 1024 * 1024;
export const artifactWriteGraceMs = 10 * 60_000;
const uuid =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const storageKeyPattern = new RegExp(
  "^" + uuid + "/" + uuid + "/" + uuid + "/primary[.]jpg$",
  "i",
);
const temporaryFilePattern = new RegExp(
  "^primary[.]jpg[.](" + uuid + ")[.]tmp$",
  "i",
);

export function scanArtifactStorageRoot(): string {
  const configured = process.env.SCAN_ARTIFACTS_DIR?.trim();
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  return path.resolve(repositoryRoot, configured || "storage/scan-artifacts");
}

function assertUuidSegment(value: string, label: string): void {
  if (!new RegExp("^" + uuid + "$", "i").test(value)) {
    throw new Error("Invalid " + label + " for artifact storage");
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

  return [input.organizationId, input.siteId, input.scanId, "primary.jpg"].join(
    "/",
  );
}

function artifactPath(storageKey: string): string {
  if (!storageKeyPattern.test(storageKey)) {
    throw new Error("Invalid artifact storage key");
  }
  const root = scanArtifactStorageRoot();
  const resolved = path.resolve(root, ...storageKey.split("/"));
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;

  if (!resolved.startsWith(prefix)) {
    throw new Error("Artifact path escaped storage root");
  }

  return resolved;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

async function inspectDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Unsafe artifact storage directory");
  }
}

async function ensureSafeParent(storageKey: string): Promise<string> {
  const root = scanArtifactStorageRoot();
  await inspectDirectory(root);
  let directory = root;

  for (const segment of storageKey.split("/").slice(0, 3)) {
    directory = path.join(directory, segment);
    await inspectDirectory(directory);
  }

  return directory;
}

async function writeScreenshotFile(
  storageKey: string,
  data: Buffer,
  afterRename?: () => Promise<void>,
): Promise<void> {
  const targetPath = artifactPath(storageKey);
  const directory = await ensureSafeParent(storageKey);
  const temporaryPath = path.join(
    directory,
    "primary.jpg." + randomUUID() + ".tmp",
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  let renamed = false;

  try {
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      const targetInfo = await lstat(targetPath);
      if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) {
        throw new Error("Unsafe existing artifact file");
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }

    await rename(temporaryPath, targetPath);
    renamed = true;
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    await afterRename?.();
  } catch (error) {
    if (!renamed) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (errorCode(cleanupError) !== "ENOENT") {
          throw new AggregateError(
            [error, cleanupError],
            "Artifact write and temporary-file cleanup failed",
          );
        }
      }
    }
    throw error;
  }
}

/**
 * Stores a durable write intent before touching the filesystem. The second
 * transaction locks the site and intent through rename plus metadata commit.
 * The optional hook is used by integration tests to pause or fail after rename.
 */
export async function persistPrimaryScreenshot(
  input: {
    organizationId: string;
    siteId: string;
    scanId: string;
    screenshot: BrowserScreenshot;
  },
  hooks: { afterRename?: () => Promise<void> } = {},
): Promise<boolean> {
  if (
    input.screenshot.mediaType !== "image/jpeg" ||
    input.screenshot.data.length === 0 ||
    input.screenshot.data.length > maxScreenshotBytes
  ) {
    return false;
  }

  const storageKey = primaryScreenshotStorageKey(input);
  const sha256 = createHash("sha256")
    .update(input.screenshot.data)
    .digest("hex");
  const byteSize = input.screenshot.data.length;
  const { db } = getDatabase();
  const reserved = await db.transaction(async (tx) => {
    const [site] = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(
        and(
          eq(sites.id, input.siteId),
          eq(sites.organizationId, input.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!site) return false;

    const [scan] = await tx
      .select({ id: scans.id, status: scans.status })
      .from(scans)
      .where(
        and(
          eq(scans.id, input.scanId),
          eq(scans.siteId, input.siteId),
          eq(scans.organizationId, input.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!scan || scan.status !== "completed") return false;

    const [existingArtifact] = await tx
      .select({ storageKey: scanArtifacts.storageKey })
      .from(scanArtifacts)
      .where(
        and(
          eq(scanArtifacts.scanId, input.scanId),
          eq(scanArtifacts.kind, "primary-screenshot"),
        ),
      )
      .limit(1);
    if (existingArtifact && existingArtifact.storageKey !== storageKey) {
      throw new Error(
        "Existing screenshot metadata has a different storage key",
      );
    }

    const [task] = await tx
      .select()
      .from(artifactCleanupTasks)
      .where(eq(artifactCleanupTasks.storageKey, storageKey))
      .for("update")
      .limit(1);
    if (task?.action === "delete") return false;
    if (
      task &&
      (task.action !== "write_intent" ||
        task.organizationId !== input.organizationId ||
        task.siteId !== input.siteId ||
        task.scanId !== input.scanId)
    ) {
      throw new Error("Conflicting artifact cleanup journal entry");
    }

    const now = new Date();
    if (task) {
      await tx
        .update(artifactCleanupTasks)
        .set({
          nextAttemptAt: new Date(now.getTime() + artifactWriteGraceMs),
          lastErrorCode: null,
        })
        .where(eq(artifactCleanupTasks.id, task.id));
    } else {
      await tx.insert(artifactCleanupTasks).values({
        storageKey,
        action: "write_intent",
        organizationId: input.organizationId,
        siteId: input.siteId,
        scanId: input.scanId,
        nextAttemptAt: new Date(now.getTime() + artifactWriteGraceMs),
        createdAt: now,
      });
    }

    return true;
  });

  if (!reserved) return false;

  return db.transaction(async (tx) => {
    // Site deletion and retention acquire this same lock before inspecting
    // artifacts, so they either wait for this commit or fence the write.
    const [site] = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(
        and(
          eq(sites.id, input.siteId),
          eq(sites.organizationId, input.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!site) return false;

    const [scan] = await tx
      .select({ id: scans.id, status: scans.status })
      .from(scans)
      .where(
        and(
          eq(scans.id, input.scanId),
          eq(scans.siteId, input.siteId),
          eq(scans.organizationId, input.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!scan || scan.status !== "completed") return false;

    const [task] = await tx
      .select()
      .from(artifactCleanupTasks)
      .where(
        and(
          eq(artifactCleanupTasks.storageKey, storageKey),
          eq(artifactCleanupTasks.action, "write_intent"),
          eq(artifactCleanupTasks.organizationId, input.organizationId),
          eq(artifactCleanupTasks.siteId, input.siteId),
          eq(artifactCleanupTasks.scanId, input.scanId),
        ),
      )
      .for("update")
      .limit(1);
    if (!task) return false;

    await writeScreenshotFile(
      storageKey,
      input.screenshot.data,
      hooks.afterRename,
    );

    await tx
      .insert(scanArtifacts)
      .values({
        organizationId: input.organizationId,
        siteId: input.siteId,
        scanId: input.scanId,
        kind: "primary-screenshot",
        storageKey,
        mediaType: input.screenshot.mediaType,
        byteSize,
        sha256,
      })
      .onConflictDoUpdate({
        target: [scanArtifacts.scanId, scanArtifacts.kind],
        set: {
          organizationId: input.organizationId,
          siteId: input.siteId,
          storageKey,
          mediaType: input.screenshot.mediaType,
          byteSize,
          sha256,
          createdAt: new Date(),
        },
      });

    await tx
      .delete(artifactCleanupTasks)
      .where(eq(artifactCleanupTasks.id, task.id));

    return true;
  });
}

/** Strict final-file key validation shared with the offline inventory tool. */
export function isValidArtifactStorageKey(storageKey: string): boolean {
  return storageKeyPattern.test(storageKey);
}

/** Strict writer temporary name validation shared with the offline inventory tool. */
export function isValidArtifactTemporaryName(name: string): boolean {
  return temporaryFilePattern.test(name);
}
