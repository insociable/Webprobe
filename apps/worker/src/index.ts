import { config } from "dotenv";
import { Queue, Worker } from "bullmq";
import pino from "pino";
import { z } from "zod";
import { SCAN_QUEUE_NAME, type ScanJob } from "@agency-saas/contracts";
import { closeDatabase, getDatabase } from "./database.js";
import { startNotificationDeliveryCoordinator } from "./notification-delivery.js";
import { sendScanNotificationEmail } from "./notification-email.js";
import { processScanJob } from "./scan-processor.js";
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

const schedulerQueue = new Queue<ScanJob>(SCAN_QUEUE_NAME, {
  connection: producerConnection,
});

const worker = new Worker<ScanJob>(
  SCAN_QUEUE_NAME,
  async (job) => {
    const result = await processScanJob(job.data);

    logger.info(
      {
        jobId: job.id,
        scanId: result.scanId,
        status: result.status,
        statusCode: result.http.ok ? result.http.statusCode : undefined,
        failureKind: result.http.ok ? undefined : result.http.error.kind,
        redirects: result.http.redirects.length,
        findings: result.findings.length,
      },
      "scan completed",
    );

    return result;
  },
  { connection, concurrency: 2 },
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
    },
    "scan job failed",
  );
});

const schedulerCoordinator = startScheduledScanCoordinator({
  logger,
  enqueue: async (payload) => {
    await schedulerQueue.add("scheduled-scan", payload, {
      jobId: payload.scanId,
      removeOnComplete: true,
      removeOnFail: true,
    });
  },
  hasJob: async (scanId) => (await schedulerQueue.getJob(scanId)) !== undefined,
});

const notificationCoordinator = startNotificationDeliveryCoordinator({
  logger,
  sender: sendScanNotificationEmail,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "stopping scanner worker");
  await schedulerCoordinator.stop();
  await notificationCoordinator.stop();
  await worker.close();
  await schedulerQueue.close();
  await closeDatabase();
  process.exitCode = 0;
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

logger.info({ queue: SCAN_QUEUE_NAME }, "scanner worker ready");
