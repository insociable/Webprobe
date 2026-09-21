import { config } from "dotenv";
import { Worker } from "bullmq";
import pino from "pino";
import { z } from "zod";
import {
  SCAN_QUEUE_NAME,
  ScanJobSchema,
  type ScanJob,
} from "@agency-saas/contracts";
import { probeHttpTarget } from "./http-probe.js";

config({ path: new URL("../../../.env", import.meta.url) });

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
    const payload = ScanJobSchema.parse(job.data);
    const httpProbe = await probeHttpTarget(payload.targetUrl);

    logger.info(
      {
        jobId: job.id,
        scanId: payload.scanId,
        ok: httpProbe.ok,
        statusCode: httpProbe.ok ? httpProbe.statusCode : undefined,
        failureKind: httpProbe.ok ? undefined : httpProbe.error.kind,
        redirects: httpProbe.redirects.length,
      },
      "HTTP probe completed",
    );

    return {
      scanId: payload.scanId,
      completedAt: new Date().toISOString(),
      targetUrl: payload.targetUrl,
      http: httpProbe,
    };
  },
  { connection, concurrency: 2 },
);

worker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "scan job completed");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error }, "scan job failed");
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "stopping scanner worker");
  await worker.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

logger.info({ queue: SCAN_QUEUE_NAME }, "scanner worker ready");
