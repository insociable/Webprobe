import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { artifactCleanupTasks, scanArtifacts, scans } from "@agency-saas/db";
import { and, asc, count, eq, lte, min } from "drizzle-orm";
import type { Logger } from "pino";
import { getDatabase } from "./database.js";
import {
  artifactWriteGraceMs,
  isValidArtifactStorageKey,
  isValidArtifactTemporaryName,
  scanArtifactStorageRoot,
} from "./scan-artifacts.js";

const INTERVAL_MS = 60_000;
const BATCH_SIZE = 100;
const OVERDUE_MS = 24 * 60 * 60_000;

type CleanupErrorCode =
  | "filesystem-error"
  | "unsafe-storage-key"
  | "still-referenced";

class CleanupError extends Error {
  constructor(readonly code: CleanupErrorCode) {
    super(code);
  }
}

function errorCode(error: unknown): CleanupErrorCode | null {
  if (error instanceof CleanupError) return error.code;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    return null;
  }
  return "filesystem-error";
}

async function safeDirectory(storageKey: string): Promise<string | null> {
  if (!isValidArtifactStorageKey(storageKey)) {
    throw new CleanupError("unsafe-storage-key");
  }
  let directory = scanArtifactStorageRoot();
  const segments = storageKey.split("/");
  try {
    const rootInfo = await lstat(directory);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new CleanupError("unsafe-storage-key");
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }

  for (const segment of segments.slice(0, -1)) {
    directory = path.join(directory, segment);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new CleanupError("unsafe-storage-key");
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  return directory;
}

// Removes only the expected final image and writer temporary files in its
// validated scan directory. It never follows symlinks or removes directories.
async function removeArtifact(storageKey: string): Promise<void> {
  const directory = await safeDirectory(storageKey);
  if (!directory) return;

  const target = path.join(directory, "primary.jpg");
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new CleanupError("unsafe-storage-key");
    }
    await unlink(target);
  } catch (error) {
    const code = errorCode(error);
    if (code !== null) throw error;
  }

  const entries = await readdir(directory);
  for (const name of entries) {
    if (!isValidArtifactTemporaryName(name)) continue;
    const temporaryPath = path.join(directory, name);
    try {
      const info = await lstat(temporaryPath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new CleanupError("unsafe-storage-key");
      }
      await unlink(temporaryPath);
    } catch (error) {
      const code = errorCode(error);
      if (code !== null) throw error;
    }
  }
}

export type ArtifactCleanupResult = {
  checked: number;
  removed: number;
  released: number;
  deferred: number;
  retried: number;
  pending: number;
  oldestPendingAgeMs: number;
};

export async function purgePendingArtifacts(
  now = new Date(),
  batchSize = BATCH_SIZE,
): Promise<ArtifactCleanupResult> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("Invalid artifact cleanup batch size");
  }
  const { db } = getDatabase();
  const result: ArtifactCleanupResult = {
    checked: 0,
    removed: 0,
    released: 0,
    deferred: 0,
    retried: 0,
    pending: 0,
    oldestPendingAgeMs: 0,
  };

  await db.transaction(async (tx) => {
    // Row locks serialize cleanup against capture finalization. A crashed
    // transaction releases the lock; its durable write intent remains queued.
    const tasks = await tx
      .select()
      .from(artifactCleanupTasks)
      .where(lte(artifactCleanupTasks.nextAttemptAt, now))
      .orderBy(
        asc(artifactCleanupTasks.nextAttemptAt),
        asc(artifactCleanupTasks.id),
      )
      .limit(batchSize)
      .for("update", { skipLocked: true });

    result.checked = tasks.length;
    for (const task of tasks) {
      if (task.action !== "delete" && task.action !== "write_intent") {
        throw new Error("Unsupported artifact cleanup action");
      }

      const [referenced] = await tx
        .select({ id: scanArtifacts.id })
        .from(scanArtifacts)
        .where(eq(scanArtifacts.storageKey, task.storageKey))
        .limit(1);

      if (referenced && task.action === "write_intent") {
        // A committed artifact and its intent should normally be removed in
        // one transaction. Release a duplicate intent without touching bytes.
        await tx
          .delete(artifactCleanupTasks)
          .where(eq(artifactCleanupTasks.id, task.id));
        result.released += 1;
        continue;
      }
      if (referenced) {
        const attempts = Math.min(task.attempts + 1, 2_147_483_647);
        const delayMs = Math.min(
          60 * 60_000,
          60_000 * 2 ** Math.min(attempts - 1, 6),
        );
        await tx
          .update(artifactCleanupTasks)
          .set({
            attempts,
            lastErrorCode: "still-referenced",
            nextAttemptAt: new Date(now.getTime() + delayMs),
          })
          .where(eq(artifactCleanupTasks.id, task.id));
        result.retried += 1;
        continue;
      }

      if (task.action === "write_intent") {
        const [scan] =
          task.scanId && task.siteId && task.organizationId
            ? await tx
                .select({ status: scans.status })
                .from(scans)
                .where(
                  and(
                    eq(scans.id, task.scanId),
                    eq(scans.siteId, task.siteId),
                    eq(scans.organizationId, task.organizationId),
                  ),
                )
                .limit(1)
            : [];
        if (scan && (scan.status === "queued" || scan.status === "running")) {
          await tx
            .update(artifactCleanupTasks)
            .set({
              nextAttemptAt: new Date(now.getTime() + artifactWriteGraceMs),
            })
            .where(eq(artifactCleanupTasks.id, task.id));
          result.deferred += 1;
          continue;
        }
      }

      let failure: CleanupErrorCode | null = null;
      try {
        await removeArtifact(task.storageKey);
      } catch (error) {
        failure = errorCode(error);
      }

      if (failure === null) {
        await tx
          .delete(artifactCleanupTasks)
          .where(eq(artifactCleanupTasks.id, task.id));
        result.removed += 1;
      } else {
        const attempts = Math.min(task.attempts + 1, 2_147_483_647);
        const delayMs = Math.min(
          60 * 60_000,
          60_000 * 2 ** Math.min(attempts - 1, 6),
        );
        await tx
          .update(artifactCleanupTasks)
          .set({
            attempts,
            lastErrorCode: failure,
            nextAttemptAt: new Date(now.getTime() + delayMs),
          })
          .where(eq(artifactCleanupTasks.id, task.id));
        result.retried += 1;
      }
    }
  });

  const [backlog] = await db
    .select({ pending: count(), oldest: min(artifactCleanupTasks.createdAt) })
    .from(artifactCleanupTasks);
  result.pending = Number(backlog?.pending ?? 0);
  result.oldestPendingAgeMs = backlog?.oldest
    ? Math.max(0, now.getTime() - new Date(backlog.oldest).getTime())
    : 0;
  return result;
}

export function startArtifactCleanupCoordinator(options: { logger: Logger }) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current = Promise.resolve();

  const execute = async () => {
    try {
      const result = await purgePendingArtifacts();
      if (result.retried > 0 || result.oldestPendingAgeMs >= OVERDUE_MS) {
        options.logger.warn(result, "artifact cleanup requires retry");
      } else if (
        result.checked > 0 ||
        result.pending > 0 ||
        result.released > 0 ||
        result.deferred > 0
      ) {
        options.logger.info(result, "artifact cleanup tick");
      }
    } catch (error) {
      options.logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "artifact cleanup tick failed",
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          current = execute();
        }, INTERVAL_MS);
      }
    }
  };
  current = execute();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      await current;
    },
  };
}
