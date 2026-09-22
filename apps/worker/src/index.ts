import { config } from "dotenv";
import { Worker } from "bullmq";
import pino from "pino";
import { z } from "zod";
import { SCAN_QUEUE_NAME, type ScanJob } from "@agency-saas/contracts";
import { closeDatabase, getDatabase } from "./database.js";
import { processScanJob } from "./scan-processor.js";

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

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "stopping scanner worker");
  await worker.close();
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
