import { config } from "dotenv";
import { Queue, UnrecoverableError, Worker, type JobsOptions } from "bullmq";
import pino from "pino";
import { SCAN_QUEUE_NAME, type ScanJob } from "@agency-saas/contracts";
import { closeDatabase, getDatabase } from "./database.js";
import { startNotificationDeliveryCoordinator } from "./notification-delivery.js";
import { sendScanNotificationEmail } from "./notification-email.js";
import { startWorkerObservability } from "./observability.js";
import { startReportDeliveryCoordinator } from "./report-delivery.js";
import { startScanDispatchCoordinator } from "./scan-dispatch.js";
import { persistScanFailureForJob } from "./scan-persistence.js";
import {
  getPublicAuditRetentionPolicy,
  startPublicAuditRetentionCoordinator,
} from "./public-audit-retention.js";
import { processScanJobAttempt } from "./scan-processor.js";
import { parseRedisConnectionUrl } from "./redis-connection.js";
import {
  runInternalDeepWorkerJob,
  scanModeForWorkerJob,
} from "./internal-deep-worker.js";
import {
  beginScanAttempt,
  classifyScanError,
  completeScanAttempt,
  failScanAttempt,
  MAX_SCAN_EXECUTION_ATTEMPTS,
} from "./scan-retry.js";
import { startScheduledScanCoordinator } from "./scan-scheduler.js";

config({ path: new URL("../../../.env", import.meta.url) });
void getDatabase();

const logger = pino({ name: "scanner-worker" });
const redisConnection = parseRedisConnectionUrl(process.env.REDIS_URL);

const connection = {
  ...redisConnection,
  maxRetriesPerRequest: null,
};

const producerConnection = {
  ...connection,
  connectTimeout: 5_000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
};

const scanQueue = new Queue<ScanJob>(SCAN_QUEUE_NAME, {
  connection: producerConnection,
});

const scanJobOptions: JobsOptions = {
  attempts: MAX_SCAN_EXECUTION_ATTEMPTS,
  backoff: {
    type: "exponential",
    delay: 15_000,
  },
  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 10_000,
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 10_000,
  },
};

const activeDeepJobs = new Set<AbortController>();

const worker = new Worker<ScanJob>(
  SCAN_QUEUE_NAME,
  async (job) => {
    // Route by the database mode before beginScanAttempt: the V2 attempt writer
    // does not understand Deep lease tokens and must never touch a Deep job.
    const route = await scanModeForWorkerJob(job.data);
    if (route.mode === "verified_deep_audit") {
      const controller = new AbortController();
      activeDeepJobs.add(controller);
      try {
        const result = await runInternalDeepWorkerJob({
          payload: route.payload,
          attemptsMade: job.attemptsMade,
          configuredAttempts: job.opts.attempts ?? 1,
          signal: controller.signal,
        });
        logger.info({ jobId: job.id, ...result }, "internal Deep job finished");
        return result;
      } finally {
        activeDeepJobs.delete(controller);
      }
    }
    let attempt: Awaited<ReturnType<typeof beginScanAttempt>> | undefined;

    try {
      attempt = await beginScanAttempt(job.data.scanId);
      const result = await processScanJobAttempt(job.data);

      try {
        await completeScanAttempt(attempt);
      } catch (error) {
        logger.error(
          {
            jobId: job.id,
            scanId: job.data.scanId,
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          "scan attempt completion history update failed",
        );
      }

      logger.info(
        {
          jobId: job.id,
          scanId: result.scanId,
          attemptNumber: attempt.attemptNumber,
          status: result.status,
          statusCode: result.http.ok ? result.http.statusCode : undefined,
          failureKind: result.http.ok ? undefined : result.http.error.kind,
          redirects: result.http.redirects.length,
          pagesVisited: result.pagesVisited,
          findings: result.findings.length,
          screenshotStored: result.screenshotStored,
        },
        "scan completed",
      );

      return result;
    } catch (error) {
      const classification = classifyScanError(error);
      const configuredAttempts = job.opts.attempts ?? 1;
      const currentBullAttempt = job.attemptsMade + 1;
      const willRetry =
        classification.retryable && currentBullAttempt < configuredAttempts;

      if (attempt) {
        try {
          await failScanAttempt(attempt, classification, !willRetry);
        } catch (historyError) {
          logger.error(
            {
              jobId: job.id,
              scanId: job.data.scanId,
              errorName:
                historyError instanceof Error
                  ? historyError.name
                  : "UnknownError",
            },
            "scan attempt failure history update failed",
          );
        }
      }

      if (!willRetry) {
        try {
          await persistScanFailureForJob(job.data, error);
        } catch (persistenceError) {
          logger.error(
            {
              jobId: job.id,
              scanId: job.data.scanId,
              errorName:
                persistenceError instanceof Error
                  ? persistenceError.name
                  : "UnknownError",
            },
            "terminal scan failure persistence failed",
          );
        }
      }

      logger.warn(
        {
          jobId: job.id,
          scanId: job.data.scanId,
          attemptNumber: attempt?.attemptNumber,
          bullAttempt: currentBullAttempt,
          retryable: classification.retryable,
          willRetry,
          errorCode: classification.code,
        },
        willRetry ? "scan attempt will retry" : "scan attempt terminal",
      );

      if (!classification.retryable) {
        throw new UnrecoverableError(classification.code);
      }
      throw error;
    }
  },
  {
    connection,
    concurrency: 2,
    maxStalledCount: 2,
    stalledInterval: 30_000,
  },
);

worker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "scan job completed");
});

worker.on("failed", (job, error) => {
  const errorCode =
    "code" in error && typeof error.code === "string" ? error.code : undefined;

  logger.error(
    {
      jobId: job?.id,
      errorName: error.name,
      errorCode,
      attemptsMade: job?.attemptsMade,
    },
    "scan job failed",
  );
});

const enqueueScan = async (payload: ScanJob) => {
  await scanQueue.add("scan", payload, {
    ...scanJobOptions,
    jobId: payload.scanId,
  });
};

const inspectScanJob = async (scanId: string) => {
  const job = await scanQueue.getJob(scanId);
  return job ? await job.getState() : ("missing" as const);
};

const hasScanJob = async (scanId: string) =>
  (await inspectScanJob(scanId)) !== "missing";

const dispatchCoordinator = startScanDispatchCoordinator({
  logger,
  enqueue: enqueueScan,
  hasJob: hasScanJob,
});

const schedulerCoordinator = startScheduledScanCoordinator({
  logger,
  hasJob: inspectScanJob,
});

const notificationCoordinator = startNotificationDeliveryCoordinator({
  logger,
  sender: sendScanNotificationEmail,
});

const reportDeliveryCoordinator = startReportDeliveryCoordinator({
  logger,
});

const observabilityCoordinator = startWorkerObservability({
  queue: scanQueue,
  logger,
});

const publicAuditRetentionPolicy = getPublicAuditRetentionPolicy();
const publicAuditRetentionCoordinator = startPublicAuditRetentionCoordinator({
  logger,
  policy: publicAuditRetentionPolicy,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "stopping scanner worker");
  for (const controller of activeDeepJobs) controller.abort();
  await observabilityCoordinator.stop();
  await publicAuditRetentionCoordinator.stop();
  await schedulerCoordinator.stop();
  await dispatchCoordinator.stop();
  await notificationCoordinator.stop();
  await reportDeliveryCoordinator.stop();
  await worker.close();
  await scanQueue.close();
  await closeDatabase();
  process.exitCode = 0;
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

logger.info(
  {
    queue: SCAN_QUEUE_NAME,
    attempts: MAX_SCAN_EXECUTION_ATTEMPTS,
    publicAuditRetentionDays: publicAuditRetentionPolicy.retentionDays,
    publicAuditRetentionBatchSize: publicAuditRetentionPolicy.batchSize,
    publicAuditRetentionIntervalMs: publicAuditRetentionPolicy.intervalMs,
  },
  "scanner worker ready",
);
