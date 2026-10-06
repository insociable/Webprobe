import {
  reportShares,
  artifactCleanupTasks,
  scanArtifacts,
  scans,
  sites,
} from "@agency-saas/db";
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
import { purgePendingArtifacts } from "./artifact-cleanup.js";
import { isValidArtifactStorageKey } from "./scan-artifacts.js";

const terminalStatuses = ["completed", "failed", "cancelled"] as const;

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

type RetentionTestHooks = {
  beforeScanDelete?: () => Promise<void>;
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

function artifactBelongsToScan(
  storageKey: string,
  organizationId: string,
  siteId: string,
  scanId: string,
): boolean {
  if (!isValidArtifactStorageKey(storageKey)) return false;
  const [keyOrganizationId, keySiteId, keyScanId] = storageKey.split("/");
  return (
    keyOrganizationId?.toLowerCase() === organizationId.toLowerCase() &&
    keySiteId?.toLowerCase() === siteId.toLowerCase() &&
    keyScanId?.toLowerCase() === scanId.toLowerCase()
  );
}

export async function purgeExpiredPublicAudits(
  now = new Date(),
  policy = getPublicAuditRetentionPolicy(),
  testHooks: RetentionTestHooks = {},
): Promise<PublicAuditRetentionResult> {
  const { db } = getDatabase();
  const cutoff = new Date(
    now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000,
  );

  const candidates = await db
    .select({
      id: scans.id,
      organizationId: scans.organizationId,
      siteId: scans.siteId,
    })
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
      const lockKey = "'report-share:scan:" + candidate.id + "'";
      await tx.execute(
        sql.raw(
          "select pg_advisory_xact_lock(hashtextextended(" + lockKey + ", 0))",
        ),
      );

      // Match the capture writer and site-deletion lock order: site, then scan,
      // then artifact rows. A concurrent writer either commits first or sees
      // the missing scan/site and leaves no late file.
      const [site] = await tx
        .select({ id: sites.id })
        .from(sites)
        .where(
          and(
            eq(sites.id, candidate.siteId),
            eq(sites.organizationId, candidate.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!site) return "gone" as const;

      const [stillCandidate] = await tx
        .select({ id: scans.id })
        .from(scans)
        .where(
          and(
            eq(scans.id, candidate.id),
            eq(scans.organizationId, candidate.organizationId),
            eq(scans.siteId, candidate.siteId),
            eq(scans.scanMode, "public_audit"),
            inArray(scans.status, terminalStatuses),
            isNotNull(scans.completedAt),
            lt(scans.completedAt, cutoff),
          ),
        )
        .for("update")
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
        .select({
          storageKey: scanArtifacts.storageKey,
          scanId: scanArtifacts.scanId,
        })
        .from(scanArtifacts)
        .where(
          and(
            eq(scanArtifacts.scanId, candidate.id),
            eq(scanArtifacts.organizationId, candidate.organizationId),
            eq(scanArtifacts.siteId, candidate.siteId),
          ),
        );
      if (
        artifacts.some(
          (artifact) =>
            !artifactBelongsToScan(
              artifact.storageKey,
              candidate.organizationId,
              candidate.siteId,
              candidate.id,
            ),
        )
      ) {
        return "artifact-failure" as const;
      }

      const writeIntents = await tx
        .select({
          storageKey: artifactCleanupTasks.storageKey,
          scanId: artifactCleanupTasks.scanId,
        })
        .from(artifactCleanupTasks)
        .where(
          and(
            eq(artifactCleanupTasks.organizationId, candidate.organizationId),
            eq(artifactCleanupTasks.siteId, candidate.siteId),
            eq(artifactCleanupTasks.scanId, candidate.id),
            eq(artifactCleanupTasks.action, "write_intent"),
          ),
        )
        .for("update");
      if (
        writeIntents.some(
          (intent) =>
            !intent.scanId ||
            !artifactBelongsToScan(
              intent.storageKey,
              candidate.organizationId,
              candidate.siteId,
              candidate.id,
            ),
        )
      ) {
        return "artifact-failure" as const;
      }

      const cleanupKeys = new Set([
        ...artifacts.map((artifact) => artifact.storageKey),
        ...writeIntents.map((intent) => intent.storageKey),
      ]);
      if (writeIntents.length > 0) {
        await tx
          .update(artifactCleanupTasks)
          .set({
            action: "delete",
            attempts: 0,
            lastErrorCode: null,
            nextAttemptAt: now,
            createdAt: now,
          })
          .where(
            and(
              eq(artifactCleanupTasks.organizationId, candidate.organizationId),
              eq(artifactCleanupTasks.siteId, candidate.siteId),
              eq(artifactCleanupTasks.scanId, candidate.id),
              eq(artifactCleanupTasks.action, "write_intent"),
            ),
          );
      }

      for (const artifact of artifacts) {
        await tx
          .insert(artifactCleanupTasks)
          .values({
            storageKey: artifact.storageKey,
            action: "delete",
            organizationId: candidate.organizationId,
            siteId: candidate.siteId,
            scanId: candidate.id,
            attempts: 0,
            lastErrorCode: null,
            nextAttemptAt: now,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: artifactCleanupTasks.storageKey,
            set: {
              action: "delete",
              organizationId: candidate.organizationId,
              siteId: candidate.siteId,
              scanId: candidate.id,
              attempts: 0,
              lastErrorCode: null,
              nextAttemptAt: now,
              createdAt: now,
            },
          });
      }

      await testHooks.beforeScanDelete?.();

      const deleted = await tx
        .delete(scans)
        .where(
          and(
            eq(scans.id, candidate.id),
            eq(scans.organizationId, candidate.organizationId),
            eq(scans.siteId, candidate.siteId),
            eq(scans.scanMode, "public_audit"),
            inArray(scans.status, terminalStatuses),
            isNotNull(scans.completedAt),
            lt(scans.completedAt, cutoff),
          ),
        )
        .returning({ id: scans.id });

      return deleted.length === 1 ? ("purged" as const) : ("gone" as const);
    });

    if (outcome === "purged") {
      result.purged += 1;
      // The deletion and durable cleanup intent are committed before unlink.
      try {
        const cleanup = await purgePendingArtifacts(now, policy.batchSize);
        result.artifactFailures += cleanup.retried;
      } catch {
        // The outbox remains durable; the worker coordinator will retry it.
        result.artifactFailures += 1;
      }
    } else if (outcome === "active-share") {
      result.skippedActiveShare += 1;
    } else if (outcome === "artifact-failure") {
      result.artifactFailures += 1;
    } else {
      result.alreadyGone += 1;
    }
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
