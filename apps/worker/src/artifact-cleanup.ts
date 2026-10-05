import { lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { artifactCleanupTasks, scanArtifacts } from "@agency-saas/db";
import { asc, count, eq, lte, min } from "drizzle-orm";
import type { Logger } from "pino";
import { getDatabase } from "./database.js";
import { scanArtifactStorageRoot } from "./scan-artifacts.js";

const uuid =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const storageKeyPattern = new RegExp(
  `^${uuid}/${uuid}/${uuid}/primary\\.jpg$`,
  "i",
);
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

// Never walk a symlinked tenant/site/scan directory or recursively remove it.
async function removeArtifact(storageKey: string): Promise<void> {
  if (
    !storageKeyPattern.test(storageKey) ||
    !storageKey.endsWith("/primary.jpg")
  ) {
    throw new CleanupError("unsafe-storage-key");
  }
  const segments = storageKey.split("/");
  let directory = scanArtifactStorageRoot();
  for (const segment of segments.slice(0, -1)) {
    directory = path.join(directory, segment);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new CleanupError("unsafe-storage-key");
    }
  }
  await unlink(path.join(directory, "primary.jpg"));
}

function errorCode(error: unknown): CleanupErrorCode | null {
  if (error instanceof CleanupError) return error.code;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    return null; // Deleted before commit, or already removed: retry succeeds.
  }
  return "filesystem-error";
}

export type ArtifactCleanupResult = {
  checked: number;
  removed: number;
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
    retried: 0,
    pending: 0,
    oldestPendingAgeMs: 0,
  };

  await db.transaction(async (tx) => {
    // A second coordinator skips claimed rows. On process loss PostgreSQL
    // releases the locks; no task is acknowledged before the file is gone.
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
      let failure: CleanupErrorCode | null = null;
      try {
        const [referenced] = await tx
          .select({ id: scanArtifacts.id })
          .from(scanArtifacts)
          .where(eq(scanArtifacts.storageKey, task.storageKey))
          .limit(1);
        if (referenced) throw new CleanupError("still-referenced");
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
      } else if (result.checked > 0 || result.pending > 0) {
        options.logger.info(result, "artifact cleanup tick");
      }
    } catch {
      options.logger.error("artifact cleanup tick failed");
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
