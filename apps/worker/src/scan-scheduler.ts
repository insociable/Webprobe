import { ScanJobSchema, type ScanJob } from "@agency-saas/contracts";
import { scanSchedules, scans, sites } from "@agency-saas/db";
import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { getDatabase } from "./database.js";

export type ScheduledScanEnqueuer = (payload: ScanJob) => Promise<void>;
export type ScheduledJobPresenceChecker = (scanId: string) => Promise<boolean>;

export type StaleScanRecoveryResult = {
  checked: number;
  recoveredScheduled: number;
  failedManual: number;
  inspectionFailed: number;
};

export type ScheduledClaimResult = {
  due: number;
  created: ScanJob[];
  skipped: number;
};

export type ScheduledDispatchResult = {
  attempted: number;
  enqueued: number;
  failed: number;
};
export async function initializeMissingScheduleCursors(
  now = new Date(),
  batchSize = 100,
): Promise<number> {
  const { db } = getDatabase();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: scanSchedules.id,
        dayOfWeek: scanSchedules.dayOfWeek,
        minuteOfDay: scanSchedules.minuteOfDay,
        timeZone: scanSchedules.timeZone,
      })
      .from(scanSchedules)
      .where(
        and(eq(scanSchedules.enabled, true), isNull(scanSchedules.nextRunAt)),
      )
      .orderBy(asc(scanSchedules.createdAt))
      .limit(batchSize)
      .for("update", { of: scanSchedules, skipLocked: true });

    for (const row of rows) {
      await tx
        .update(scanSchedules)
        .set({
          nextRunAt: sql<Date>`public.next_weekly_scan_run(
            ${row.dayOfWeek},
            ${row.minuteOfDay},
            ${row.timeZone},
            ${now.toISOString()}::timestamptz
          )`,
        })
        .where(
          and(
            eq(scanSchedules.id, row.id),
            eq(scanSchedules.enabled, true),
            isNull(scanSchedules.nextRunAt),
          ),
        );
    }

    return rows.length;
  });
}

export async function claimDueScheduledScans(
  now = new Date(),
  batchSize = 25,
): Promise<ScheduledClaimResult> {
  const { db } = getDatabase();

  return db.transaction(async (tx) => {
    const dueSchedules = await tx
      .select({
        scheduleId: scanSchedules.id,
        organizationId: scanSchedules.organizationId,
        siteId: scanSchedules.siteId,
        dayOfWeek: scanSchedules.dayOfWeek,
        minuteOfDay: scanSchedules.minuteOfDay,
        timeZone: scanSchedules.timeZone,
        dueAt: scanSchedules.nextRunAt,
        siteStatus: sites.status,
        verifiedAt: sites.verifiedAt,
        canonicalUrl: sites.canonicalUrl,
      })
      .from(scanSchedules)
      .innerJoin(
        sites,
        and(
          eq(scanSchedules.siteId, sites.id),
          eq(scanSchedules.organizationId, sites.organizationId),
        ),
      )
      .where(
        and(
          eq(scanSchedules.enabled, true),
          isNotNull(scanSchedules.nextRunAt),
          lte(scanSchedules.nextRunAt, now),
        ),
      )
      .orderBy(asc(scanSchedules.nextRunAt))
      .limit(batchSize)
      .for("update", { of: scanSchedules, skipLocked: true });

    const created: ScanJob[] = [];
    let skipped = 0;

    for (const schedule of dueSchedules) {
      const dueAt = schedule.dueAt;
      if (!dueAt) {
        skipped += 1;
        continue;
      }

      await tx
        .update(scanSchedules)
        .set({
          nextRunAt: sql<Date>`public.next_weekly_scan_run(
            ${schedule.dayOfWeek},
            ${schedule.minuteOfDay},
            ${schedule.timeZone},
            ${now.toISOString()}::timestamptz
          )`,
        })
        .where(eq(scanSchedules.id, schedule.scheduleId));

      if (schedule.siteStatus !== "active" || !schedule.verifiedAt) {
        skipped += 1;
        continue;
      }

      const [scan] = await tx
        .insert(scans)
        .values({
          organizationId: schedule.organizationId,
          siteId: schedule.siteId,
          status: "queued",
          trigger: "scheduled",
          scheduleId: schedule.scheduleId,
          scheduledFor: dueAt,
        })
        .onConflictDoNothing()
        .returning({ id: scans.id });

      if (!scan) {
        skipped += 1;
        continue;
      }

      created.push(
        ScanJobSchema.parse({
          scanId: scan.id,
          organizationId: schedule.organizationId,
          siteId: schedule.siteId,
          targetUrl: schedule.canonicalUrl,
        }),
      );
    }

    return {
      due: dueSchedules.length,
      created,
      skipped,
    };
  });
}

export async function cancelInvalidQueuedScheduledScans(
  now = new Date(),
): Promise<number> {
  const { db } = getDatabase();

  const cancelled = await db
    .update(scans)
    .set({
      status: "cancelled",
      completedAt: now,
      summary: {
        cancellation: { code: "scheduled-context-invalid" },
      },
    })
    .where(
      and(
        eq(scans.trigger, "scheduled"),
        eq(scans.status, "queued"),
        sql`(
          ${scans.scheduleId} is null
          or not exists (
            select 1
            from ${scanSchedules}
            where ${scanSchedules.id} = ${scans.scheduleId}
              and ${scanSchedules.organizationId} = ${scans.organizationId}
              and ${scanSchedules.siteId} = ${scans.siteId}
              and ${scanSchedules.enabled} = true
          )
          or not exists (
            select 1
            from ${sites}
            where ${sites.id} = ${scans.siteId}
              and ${sites.organizationId} = ${scans.organizationId}
              and ${sites.status} = 'active'
              and ${sites.verifiedAt} is not null
          )
        )`,
      ),
    )
    .returning({ id: scans.id });

  return cancelled.length;
}

export async function recoverOrphanedRunningScans(
  hasJob: ScheduledJobPresenceChecker,
  now = new Date(),
  staleAfterMs = 15 * 60_000,
  batchSize = 100,
): Promise<StaleScanRecoveryResult> {
  const { db } = getDatabase();
  const staleBefore = new Date(now.getTime() - staleAfterMs);

  const rows = await db
    .select({
      id: scans.id,
      trigger: scans.trigger,
    })
    .from(scans)
    .where(
      and(
        eq(scans.status, "running"),
        isNotNull(scans.startedAt),
        lte(scans.startedAt, staleBefore),
      ),
    )
    .orderBy(asc(scans.startedAt))
    .limit(batchSize);

  let recoveredScheduled = 0;
  let failedManual = 0;
  let inspectionFailed = 0;

  for (const row of rows) {
    let present: boolean;
    try {
      present = await hasJob(row.id);
    } catch {
      inspectionFailed += 1;
      continue;
    }

    if (present) {
      continue;
    }

    if (row.trigger === "scheduled") {
      const recovered = await db
        .update(scans)
        .set({
          status: "queued",
          startedAt: null,
          completedAt: null,
        })
        .where(and(eq(scans.id, row.id), eq(scans.status, "running")))
        .returning({ id: scans.id });

      recoveredScheduled += recovered.length;
      continue;
    }

    const failed = await db
      .update(scans)
      .set({
        status: "failed",
        completedAt: now,
        summary: {
          error: { code: "stale-worker-job" },
        },
      })
      .where(and(eq(scans.id, row.id), eq(scans.status, "running")))
      .returning({ id: scans.id });

    failedManual += failed.length;
  }

  return {
    checked: rows.length,
    recoveredScheduled,
    failedManual,
    inspectionFailed,
  };
}

export async function dispatchQueuedScheduledScans(
  enqueue: ScheduledScanEnqueuer,
  batchSize = 100,
): Promise<ScheduledDispatchResult> {
  const { db } = getDatabase();

  const rows = await db
    .select({
      scanId: scans.id,
      organizationId: scans.organizationId,
      siteId: scans.siteId,
      targetUrl: sites.canonicalUrl,
    })
    .from(scans)
    .innerJoin(
      sites,
      and(
        eq(scans.siteId, sites.id),
        eq(scans.organizationId, sites.organizationId),
      ),
    )
    .innerJoin(
      scanSchedules,
      and(
        eq(scans.scheduleId, scanSchedules.id),
        eq(scans.organizationId, scanSchedules.organizationId),
        eq(scans.siteId, scanSchedules.siteId),
      ),
    )
    .where(
      and(
        eq(scans.trigger, "scheduled"),
        eq(scans.status, "queued"),
        eq(scanSchedules.enabled, true),
        eq(sites.status, "active"),
        isNotNull(sites.verifiedAt),
      ),
    )
    .orderBy(asc(scans.queuedAt))
    .limit(batchSize);

  let enqueued = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = ScanJobSchema.parse(row);
    try {
      await enqueue(payload);
      enqueued += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    attempted: rows.length,
    enqueued,
    failed,
  };
}

export async function runScheduledScanTick(
  enqueue: ScheduledScanEnqueuer,
  hasJob: ScheduledJobPresenceChecker,
  now = new Date(),
) {
  const initialized = await initializeMissingScheduleCursors(now);
  const staleRecovery = await recoverOrphanedRunningScans(hasJob, now);
  const cancelled = await cancelInvalidQueuedScheduledScans(now);
  const claim = await claimDueScheduledScans(now);
  const dispatch = await dispatchQueuedScheduledScans(enqueue);

  return {
    initialized,
    staleRecovery,
    cancelled,
    claim,
    dispatch,
  };
}

export function startScheduledScanCoordinator(options: {
  enqueue: ScheduledScanEnqueuer;
  hasJob: ScheduledJobPresenceChecker;
  logger: Logger;
  intervalMs?: number;
}) {
  const intervalMs = options.intervalMs ?? 30_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current = Promise.resolve();

  const execute = async () => {
    try {
      const result = await runScheduledScanTick(
        options.enqueue,
        options.hasJob,
      );
      const activity =
        result.initialized +
        result.staleRecovery.recoveredScheduled +
        result.staleRecovery.failedManual +
        result.cancelled +
        result.claim.due +
        result.dispatch.attempted;

      if (activity > 0 || result.dispatch.failed > 0) {
        options.logger.info(
          {
            schedulesInitialized: result.initialized,
            staleScansChecked: result.staleRecovery.checked,
            staleScheduledRecovered: result.staleRecovery.recoveredScheduled,
            staleManualFailed: result.staleRecovery.failedManual,
            staleInspectionFailed: result.staleRecovery.inspectionFailed,
            scansCancelled: result.cancelled,
            schedulesDue: result.claim.due,
            scansCreated: result.claim.created.length,
            schedulesSkipped: result.claim.skipped,
            dispatchAttempted: result.dispatch.attempted,
            dispatchEnqueued: result.dispatch.enqueued,
            dispatchFailed: result.dispatch.failed,
          },
          "scheduled scan coordinator tick",
        );
      }
    } catch (error) {
      options.logger.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorCode:
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
              ? error.code
              : undefined,
        },
        "scheduled scan coordinator tick failed",
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
      if (timer) {
        clearTimeout(timer);
      }
      await current;
    },
  };
}
