import { unlink } from "node:fs/promises";
import path from "node:path";
import { reportShares, scanArtifacts, scans } from "@agency-saas/db";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import type { Logger } from "pino";
import { getDatabase } from "./database.js";
import { scanArtifactStorageRoot } from "./scan-artifacts.js";

const terminalStatuses = ["completed", "failed", "cancelled"] as const;
const storageKeyPattern =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/primary\.jpg$/i;

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_INTERVAL_SECONDS = 6 * 60 * 60;

export type PublicAuditRetentionPolicy = {
  retentionDays: number;
  batchSize: number;
  intervalMs: number;
};

export type PublicAuditRetentionResult = {
  checked: number;
  purged: number;
  skippedActiveShare: number;
  artifactFailures: number;
  alreadyGone: number;
};

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function getPublicAuditRetentionPolicy(
  env: Record<string, string | undefined> = process.env,
): PublicAuditRetentionPolicy {
  return {
    retentionDays: boundedInteger(
      env.PUBLIC_AUDIT_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
      1,
      3650,
    ),
    batchSize: boundedInteger(
      env.PUBLIC_AUDIT_RETENTION_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      1,
      500,
    ),
    intervalMs:
      boundedInteger(
        env.PUBLIC_AUDIT_RETENTION_INTERVAL_SECONDS,
        DEFAULT_INTERVAL_SECONDS,
        300,
        24 * 60 * 60,
      ) * 1000,
  };
}

function artifactPath(storageKey: string): string {
  if (!storageKeyPattern.test(storageKey)) {
    throw new Error("Invalid retained scan artifact storage key");
  }

  const root = scanArtifactStorageRoot();
  const resolved = path.resolve(root, ...storageKey.split("/"));
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (!resolved.startsWith(prefix)) {
    throw new Error("Retained scan artifact escaped storage root");
  }

  return resolved;
}

async function removeArtifact(storageKey: string): Promise<void> {
  try {
    await unlink(artifactPath(storageKey));
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

export async function purgeExpiredPublicAudits(
  now = new Date(),
  policy = getPublicAuditRetentionPolicy(),
): Promise<PublicAuditRetentionResult> {
  const { db } = getDatabase();
  const cutoff = new Date(
    now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000,
  );

  const candidates = await db
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(
        eq(scans.scanMode, "public_audit"),
        inArray(scans.status, terminalStatuses),
        isNotNull(scans.completedAt),
        lt(scans.completedAt, cutoff),
      ),
    )
    .orderBy(asc(scans.completedAt))
    .limit(policy.batchSize);

  const result: PublicAuditRetentionResult = {
    checked: candidates.length,
    purged: 0,
    skippedActiveShare: 0,
    artifactFailures: 0,
    alreadyGone: 0,
  };

  for (const candidate of candidates) {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`report-share:scan:${candidate.id}`}, 0))`,
      );

      const [stillCandidate] = await tx
        .select({ id: scans.id })
        .from(scans)
        .where(
          and(
            eq(scans.id, candidate.id),
            eq(scans.scanMode, "public_audit"),
            inArray(scans.status, terminalStatuses),
            isNotNull(scans.completedAt),
            lt(scans.completedAt, cutoff),
          ),
        )
        .limit(1);

      if (!stillCandidate) return "gone" as const;

      const [activeShare] = await tx
        .select({ id: reportShares.id })
        .from(reportShares)
        .where(
          and(
            eq(reportShares.scanId, candidate.id),
            isNull(reportShares.revokedAt),
            gt(reportShares.expiresAt, now),
          ),
        )
        .limit(1);

      if (activeShare) return "active-share" as const;

      const artifacts = await tx
        .select({ storageKey: scanArtifacts.storageKey })
        .from(scanArtifacts)
        .where(eq(scanArtifacts.scanId, candidate.id));

      try {
        for (const artifact of artifacts) {
          await removeArtifact(artifact.storageKey);
        }
      } catch {
        return "artifact-failure" as const;
      }

      const deleted = await tx
        .delete(scans)
        .where(
          and(
            eq(scans.id, candidate.id),
            eq(scans.scanMode, "public_audit"),
            inArray(scans.status, terminalStatuses),
            isNotNull(scans.completedAt),
            lt(scans.completedAt, cutoff),
          ),
        )
        .returning({ id: scans.id });

      return deleted.length === 1 ? ("purged" as const) : ("gone" as const);
    });

    if (outcome === "purged") result.purged += 1;
    else if (outcome === "active-share") result.skippedActiveShare += 1;
    else if (outcome === "artifact-failure") result.artifactFailures += 1;
    else result.alreadyGone += 1;
  }

  return result;
}

export function startPublicAuditRetentionCoordinator(options: {
  logger: Logger;
  intervalMs?: number;
  policy?: PublicAuditRetentionPolicy;
}) {
  const policy = options.policy ?? getPublicAuditRetentionPolicy();
  const intervalMs = options.intervalMs ?? policy.intervalMs;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current = Promise.resolve();

  const execute = async () => {
    try {
      const result = await purgeExpiredPublicAudits(new Date(), policy);
      if (
        result.checked > 0 ||
        result.artifactFailures > 0 ||
        result.skippedActiveShare > 0
      ) {
        options.logger.info(
          { retentionDays: policy.retentionDays, ...result },
          "public audit retention tick",
        );
      }
    } catch (error) {
      options.logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "public audit retention tick failed",
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          current = execute();
        }, intervalMs);
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
