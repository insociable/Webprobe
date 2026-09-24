import {
  WORKER_HEALTH_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
  WorkerHealthSnapshotSchema,
  type ScanJob,
  type WorkerHealthSnapshot,
} from "@agency-saas/contracts";
import type { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import { chromium } from "playwright";
import { getDatabase } from "./database.js";

const METRICS_WINDOW_MS = 24 * 60 * 60_000;
const STALE_SCAN_MS = 15 * 60_000;
const BROWSER_PROBE_INTERVAL_MS = 60_000;

type BrowserHealth = WorkerHealthSnapshot["browser"];

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function collectDatabaseHealth(
  now: Date,
): Promise<WorkerHealthSnapshot["database"]> {
  try {
    const { client } = getDatabase();
    const since = new Date(now.getTime() - METRICS_WINDOW_MS).toISOString();
    const staleBefore = new Date(now.getTime() - STALE_SCAN_MS).toISOString();

    const [scanMetrics] = await client`
      select
        count(*) filter (where status = 'running')::int as scans_running,
        count(*) filter (
          where status = 'running'
            and started_at is not null
            and started_at <= ${staleBefore}::timestamptz
        )::int as scans_stale,
        count(*) filter (
          where status = 'running'
            and scan_mode = 'verified_deep_audit'
        )::int as deep_scans_running,
        count(*) filter (
          where status = 'running'
            and scan_mode = 'verified_deep_audit'
            and started_at is not null
            and started_at <= ${staleBefore}::timestamptz
        )::int as deep_scans_stale,
        count(*) filter (
          where status = 'completed'
            and scan_mode = 'verified_deep_audit'
            and completed_at >= ${since}::timestamptz
        )::int as deep_success_last_24h,
        count(*) filter (
          where status = 'failed'
            and scan_mode = 'verified_deep_audit'
            and completed_at >= ${since}::timestamptz
        )::int as deep_failed_last_24h,
        count(*) filter (
          where status = 'completed'
            and completed_at >= ${since}::timestamptz
        )::int as success_last_24h,
        count(*) filter (
          where status = 'failed'
            and completed_at >= ${since}::timestamptz
        )::int as failed_last_24h,
        avg(
          extract(epoch from (completed_at - started_at)) * 1000
        ) filter (
          where status in ('completed', 'failed')
            and started_at is not null
            and completed_at is not null
            and completed_at >= ${since}::timestamptz
        ) as average_duration_ms_last_24h
      from scans
    `;

    const [dispatchMetrics] = await client`
      select
        count(*) filter (
          where status in ('pending', 'dispatching')
        )::int as dispatch_pending,
        count(*) filter (
          where status in ('pending', 'dispatching')
            and last_error_code is not null
        )::int as dispatch_errors
      from scan_dispatches
    `;

    const successLast24h = numberValue(scanMetrics?.success_last_24h);
    const failedLast24h = numberValue(scanMetrics?.failed_last_24h);
    const terminalLast24h = successLast24h + failedLast24h;
    const rawAverage = scanMetrics?.average_duration_ms_last_24h;

    return {
      status: "up",
      scansRunning: numberValue(scanMetrics?.scans_running),
      scansStale: numberValue(scanMetrics?.scans_stale),
      deepScansRunning: numberValue(scanMetrics?.deep_scans_running),
      deepScansStale: numberValue(scanMetrics?.deep_scans_stale),
      deepSuccessLast24h: numberValue(scanMetrics?.deep_success_last_24h),
      deepFailedLast24h: numberValue(scanMetrics?.deep_failed_last_24h),
      successLast24h,
      failedLast24h,
      successRateLast24h:
        terminalLast24h === 0 ? null : successLast24h / terminalLast24h,
      averageDurationMsLast24h:
        rawAverage === null || rawAverage === undefined
          ? null
          : Math.max(0, numberValue(rawAverage)),
      dispatchPending: numberValue(dispatchMetrics?.dispatch_pending),
      dispatchErrors: numberValue(dispatchMetrics?.dispatch_errors),
    };
  } catch {
    return {
      status: "down",
      scansRunning: 0,
      scansStale: 0,
      deepScansRunning: 0,
      deepScansStale: 0,
      deepSuccessLast24h: 0,
      deepFailedLast24h: 0,
      successLast24h: 0,
      failedLast24h: 0,
      successRateLast24h: null,
      averageDurationMsLast24h: null,
      dispatchPending: 0,
      dispatchErrors: 0,
    };
  }
}

async function collectQueueHealth(
  queue: Queue<ScanJob>,
  now: Date,
): Promise<WorkerHealthSnapshot["queue"]> {
  try {
    const [waiting, active, delayed, failed, oldestJobs] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getDelayedCount(),
      queue.getFailedCount(),
      queue.getJobs(["waiting", "delayed"], 0, 0, true),
    ]);
    const oldest = oldestJobs[0];
    const oldestPendingAgeMs = oldest?.timestamp
      ? Math.max(0, now.getTime() - oldest.timestamp)
      : null;

    return {
      status: "up",
      waiting,
      active,
      delayed,
      failed,
      backlog: waiting + delayed,
      oldestPendingAgeMs,
    };
  } catch {
    return {
      status: "down",
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      backlog: 0,
      oldestPendingAgeMs: null,
    };
  }
}

export async function probeBrowserHealth(
  now = new Date(),
): Promise<BrowserHealth> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      timeout: 5_000,
    });
    return {
      status: "up",
      checkedAt: now.toISOString(),
    };
  } catch {
    return {
      status: "down",
      checkedAt: now.toISOString(),
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function collectWorkerHealthSnapshot(
  queue: Queue<ScanJob>,
  browser: BrowserHealth,
  now = new Date(),
): Promise<WorkerHealthSnapshot> {
  const [database, queueHealth] = await Promise.all([
    collectDatabaseHealth(now),
    collectQueueHealth(queue, now),
  ]);

  return WorkerHealthSnapshotSchema.parse({
    version: 1,
    checkedAt: now.toISOString(),
    database,
    queue: queueHealth,
    browser,
  });
}

async function publishWorkerHealthSnapshot(
  snapshot: WorkerHealthSnapshot,
): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for worker health publishing");
  }

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();
    await redis.set(
      WORKER_HEALTH_KEY,
      JSON.stringify(snapshot),
      "EX",
      WORKER_HEARTBEAT_TTL_SECONDS,
    );
  } finally {
    redis.disconnect();
  }
}

function isHealthy(snapshot: WorkerHealthSnapshot): boolean {
  return (
    snapshot.database.status === "up" &&
    snapshot.queue.status === "up" &&
    snapshot.browser.status === "up"
  );
}

export function startWorkerObservability(options: {
  queue: Queue<ScanJob>;
  logger: Logger;
  intervalMs?: number;
}) {
  const intervalMs = options.intervalMs ?? 10_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current = Promise.resolve();
  let tick = 0;
  let browserHealth: BrowserHealth = {
    status: "down",
    checkedAt: new Date(0).toISOString(),
  };
  let browserCheckedAt = 0;

  const execute = async () => {
    const now = new Date();

    try {
      if (now.getTime() - browserCheckedAt >= BROWSER_PROBE_INTERVAL_MS) {
        browserHealth = await probeBrowserHealth(now);
        browserCheckedAt = now.getTime();
      }

      const snapshot = await collectWorkerHealthSnapshot(
        options.queue,
        browserHealth,
        now,
      );
      await publishWorkerHealthSnapshot(snapshot);
      tick += 1;

      if (!isHealthy(snapshot) || tick % 6 === 0) {
        options.logger[isHealthy(snapshot) ? "info" : "warn"](
          { health: snapshot },
          "worker health snapshot",
        );
      }
    } catch (error) {
      options.logger.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "worker health collection failed",
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
