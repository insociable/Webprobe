import { ScanJobSchema, type ScanJob } from "@agency-saas/contracts";
import { scanDispatches, scanSchedules, scans, sites } from "@agency-saas/db";
import { and, asc, eq, isNotNull, lte, or } from "drizzle-orm";
import type { Logger } from "pino";
import { getDatabase } from "./database.js";

export type ScanDispatchEnqueuer = (payload: ScanJob) => Promise<void>;
export type ScanJobPresenceChecker = (scanId: string) => Promise<boolean>;

export type ClaimedScanDispatch = {
  scanId: string;
  organizationId: string;
  siteId: string;
  scanMode: "public_audit" | "verified_monitoring";
  targetUrl: string;
  attemptCount: number;
};

export type ScanDispatchResult = {
  attempted: number;
  dispatched: number;
  deferred: number;
  cancelled: number;
};

export type ScanDispatchReconciliationResult = {
  checked: number;
  restored: number;
  inspectionFailed: number;
};

function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 8));
  return Math.min(5 * 60_000, 2_000 * 2 ** exponent);
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 120);
  }
  if (error instanceof Error && error.name) {
    return error.name.slice(0, 120);
  }
  return "scan-dispatch-failed";
}

export async function claimDueScanDispatches(
  now = new Date(),
  batchSize = 50,
  leaseMs = 60_000,
): Promise<{ dispatches: ClaimedScanDispatch[]; cancelled: number }> {
  const { db } = getDatabase();
  const leaseUntil = new Date(now.getTime() + leaseMs);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        scanId: scanDispatches.scanId,
        attemptCount: scanDispatches.attemptCount,
        organizationId: scans.organizationId,
        siteId: scans.siteId,
        scanStatus: scans.status,
        scanTrigger: scans.trigger,
        scanMode: scans.scanMode,
        scheduleId: scans.scheduleId,
        targetUrl: sites.canonicalUrl,
        siteStatus: sites.status,
        verifiedAt: sites.verifiedAt,
        scheduleEnabled: scanSchedules.enabled,
      })
      .from(scanDispatches)
      .innerJoin(scans, eq(scanDispatches.scanId, scans.id))
      .innerJoin(
        sites,
        and(
          eq(scans.siteId, sites.id),
          eq(scans.organizationId, sites.organizationId),
        ),
      )
      .leftJoin(
        scanSchedules,
        and(
          eq(scans.scheduleId, scanSchedules.id),
          eq(scans.organizationId, scanSchedules.organizationId),
          eq(scans.siteId, scanSchedules.siteId),
        ),
      )
      .where(
        or(
          and(
            eq(scanDispatches.status, "pending"),
            lte(scanDispatches.nextAttemptAt, now),
          ),
          and(
            eq(scanDispatches.status, "dispatching"),
            isNotNull(scanDispatches.leaseUntil),
            lte(scanDispatches.leaseUntil, now),
          ),
        ),
      )
      .orderBy(asc(scanDispatches.nextAttemptAt), asc(scanDispatches.createdAt))
      .limit(batchSize)
      .for("update", { of: scanDispatches, skipLocked: true });

    const dispatches: ClaimedScanDispatch[] = [];
    let cancelled = 0;

    for (const row of rows) {
      if (row.scanStatus !== "queued") {
        const status =
          row.scanStatus === "cancelled" ? "cancelled" : "dispatched";
        await tx
          .update(scanDispatches)
          .set({
            status,
            leaseUntil: null,
            dispatchedAt: status === "dispatched" ? now : null,
            updatedAt: now,
          })
          .where(eq(scanDispatches.scanId, row.scanId));
        if (status === "cancelled") cancelled += 1;
        continue;
      }

      const invalidSchedule =
        row.scanTrigger === "scheduled" &&
        (!row.scheduleId || row.scheduleEnabled !== true);

      const invalidSite =
        row.scanMode === "verified_monitoring"
          ? row.siteStatus !== "active" || !row.verifiedAt
          : row.siteStatus !== "pending_verification" &&
            row.siteStatus !== "active";
      const invalidMode =
        row.scanTrigger === "scheduled" &&
        row.scanMode !== "verified_monitoring";

      if (invalidSite || invalidMode || invalidSchedule) {
        await tx
          .update(scans)
          .set({
            status: "cancelled",
            completedAt: now,
            summary: {
              cancellation: { code: "scan-context-invalid-before-dispatch" },
            },
          })
          .where(and(eq(scans.id, row.scanId), eq(scans.status, "queued")));
        await tx
          .update(scanDispatches)
          .set({
            status: "cancelled",
            leaseUntil: null,
            updatedAt: now,
          })
          .where(eq(scanDispatches.scanId, row.scanId));
        cancelled += 1;
        continue;
      }

      const attemptCount = row.attemptCount + 1;
      const [claimed] = await tx
        .update(scanDispatches)
        .set({
          status: "dispatching",
          attemptCount,
          leaseUntil,
          updatedAt: now,
        })
        .where(eq(scanDispatches.scanId, row.scanId))
        .returning({ scanId: scanDispatches.scanId });

      if (!claimed) continue;

      dispatches.push({
        scanId: row.scanId,
        organizationId: row.organizationId,
        siteId: row.siteId,
        scanMode: row.scanMode,
        targetUrl: row.targetUrl,
        attemptCount,
      });
    }

    return { dispatches, cancelled };
  });
}

async function markScanDispatched(
  dispatch: ClaimedScanDispatch,
  now: Date,
): Promise<boolean> {
  const { db } = getDatabase();
  const updated = await db
    .update(scanDispatches)
    .set({
      status: "dispatched",
      dispatchedAt: now,
      leaseUntil: null,
      lastErrorCode: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(scanDispatches.scanId, dispatch.scanId),
        eq(scanDispatches.status, "dispatching"),
        eq(scanDispatches.attemptCount, dispatch.attemptCount),
      ),
    )
    .returning({ scanId: scanDispatches.scanId });
  return updated.length === 1;
}

async function markScanDispatchRetry(
  dispatch: ClaimedScanDispatch,
  error: unknown,
  now: Date,
): Promise<boolean> {
  const { db } = getDatabase();
  const updated = await db
    .update(scanDispatches)
    .set({
      status: "pending",
      nextAttemptAt: new Date(
        now.getTime() + retryDelayMs(dispatch.attemptCount),
      ),
      leaseUntil: null,
      lastErrorCode: safeErrorCode(error),
      updatedAt: now,
    })
    .where(
      and(
        eq(scanDispatches.scanId, dispatch.scanId),
        eq(scanDispatches.status, "dispatching"),
        eq(scanDispatches.attemptCount, dispatch.attemptCount),
      ),
    )
    .returning({ scanId: scanDispatches.scanId });
  return updated.length === 1;
}

export async function dispatchDueScanJobs(
  enqueue: ScanDispatchEnqueuer,
  now = new Date(),
  batchSize = 50,
): Promise<ScanDispatchResult> {
  const claimed = await claimDueScanDispatches(now, batchSize);
  let dispatched = 0;
  let deferred = 0;

  for (const dispatch of claimed.dispatches) {
    const payload = ScanJobSchema.parse({
      scanId: dispatch.scanId,
      organizationId: dispatch.organizationId,
      siteId: dispatch.siteId,
      targetUrl: dispatch.targetUrl,
      profile:
        dispatch.scanMode === "public_audit"
          ? {
              maxPages: 15,
              navigationTimeoutMs: 20_000,
              checkAccessibility: true,
              captureScreenshots: true,
            }
          : undefined,
    });

    try {
      await enqueue(payload);
      if (await markScanDispatched(dispatch, new Date())) {
        dispatched += 1;
      }
    } catch (error) {
      await markScanDispatchRetry(dispatch, error, new Date());
      deferred += 1;
    }
  }

  return {
    attempted: claimed.dispatches.length,
    dispatched,
    deferred,
    cancelled: claimed.cancelled,
  };
}

export async function reconcileQueuedScanDispatches(
  hasJob: ScanJobPresenceChecker,
  now = new Date(),
  batchSize = 100,
): Promise<ScanDispatchReconciliationResult> {
  const { db } = getDatabase();
  const rows = await db
    .select({ scanId: scans.id })
    .from(scans)
    .innerJoin(scanDispatches, eq(scanDispatches.scanId, scans.id))
    .where(
      and(eq(scans.status, "queued"), eq(scanDispatches.status, "dispatched")),
    )
    .orderBy(asc(scans.queuedAt))
    .limit(batchSize);

  let restored = 0;
  let inspectionFailed = 0;

  for (const row of rows) {
    let present: boolean;
    try {
      present = await hasJob(row.scanId);
    } catch {
      inspectionFailed += 1;
      continue;
    }

    if (present) continue;

    const updated = await db
      .update(scanDispatches)
      .set({
        status: "pending",
        nextAttemptAt: now,
        leaseUntil: null,
        dispatchedAt: null,
        lastErrorCode: "queue-job-missing",
        updatedAt: now,
      })
      .where(
        and(
          eq(scanDispatches.scanId, row.scanId),
          eq(scanDispatches.status, "dispatched"),
        ),
      )
      .returning({ scanId: scanDispatches.scanId });
    restored += updated.length;
  }

  return { checked: rows.length, restored, inspectionFailed };
}

export function startScanDispatchCoordinator(options: {
  enqueue: ScanDispatchEnqueuer;
  hasJob: ScanJobPresenceChecker;
  logger: Logger;
  intervalMs?: number;
}) {
  const intervalMs = options.intervalMs ?? 2_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current = Promise.resolve();

  const execute = async () => {
    try {
      const dispatch = await dispatchDueScanJobs(options.enqueue);
      const reconciliation = await reconcileQueuedScanDispatches(
        options.hasJob,
      );
      if (
        dispatch.attempted > 0 ||
        dispatch.deferred > 0 ||
        dispatch.cancelled > 0 ||
        reconciliation.restored > 0 ||
        reconciliation.inspectionFailed > 0
      ) {
        options.logger.info(
          {
            dispatchAttempted: dispatch.attempted,
            dispatchSucceeded: dispatch.dispatched,
            dispatchDeferred: dispatch.deferred,
            dispatchCancelled: dispatch.cancelled,
            queuedJobsChecked: reconciliation.checked,
            queuedJobsRestored: reconciliation.restored,
            queueInspectionFailed: reconciliation.inspectionFailed,
          },
          "scan dispatch coordinator tick",
        );
      }
    } catch (error) {
      options.logger.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorCode: safeErrorCode(error),
        },
        "scan dispatch coordinator tick failed",
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
