import { config } from "dotenv";
import { Queue, UnrecoverableError, Worker, type JobsOptions } from "bullmq";
import pino from "pino";
import { z } from "zod";
import { SCAN_QUEUE_NAME, type ScanJob } from "@agency-saas/contracts";
import { closeDatabase, getDatabase } from "./database.js";
import { startNotificationDeliveryCoordinator } from "./notification-delivery.js";
import { sendScanNotificationEmail } from "./notification-email.js";
import { startReportDeliveryCoordinator } from "./report-delivery.js";
import { startScanDispatchCoordinator } from "./scan-dispatch.js";
import { persistScanFailureForJob } from "./scan-persistence.js";
import { processScanJobAttempt } from "./scan-processor.js";
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
const redisUrl = new URL(z.string().url().parse(process.env.REDIS_URL));

const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
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

const worker = new Worker<ScanJob>(
  SCAN_QUEUE_NAME,
  async (job) => {
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

const hasScanJob = async (scanId: string) =>
  (await scanQueue.getJob(scanId)) !== undefined;

const dispatchCoordinator = startScanDispatchCoordinator({
  logger,
  enqueue: enqueueScan,
  hasJob: hasScanJob,
});

const schedulerCoordinator = startScheduledScanCoordinator({
  logger,
  hasJob: hasScanJob,
});

const notificationCoordinator = startNotificationDeliveryCoordinator({
  logger,
  sender: sendScanNotificationEmail,
});

const reportDeliveryCoordinator = startReportDeliveryCoordinator({
  logger,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "stopping scanner worker");
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
  },
  "scanner worker ready",
);
