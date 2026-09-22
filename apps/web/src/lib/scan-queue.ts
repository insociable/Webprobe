import { Queue } from "bullmq";
import { SCAN_QUEUE_NAME, type ScanJob } from "@agency-saas/contracts";

let scanQueue: Queue<ScanJob> | undefined;

function redisConnection() {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl) {
    throw new Error("REDIS_URL is required");
  }

  const redisUrl = new URL(rawUrl);
  if (redisUrl.protocol !== "redis:" && redisUrl.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }

  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    tls: redisUrl.protocol === "rediss:" ? {} : undefined,
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  };
}

function getScanQueue(): Queue<ScanJob> {
  if (!scanQueue) {
    scanQueue = new Queue<ScanJob>(SCAN_QUEUE_NAME, {
      connection: redisConnection(),
    });
  }

  return scanQueue;
}

export type ScanEnqueuer = (payload: ScanJob) => Promise<void>;

export const enqueueScanJob: ScanEnqueuer = async (payload) => {
  const queue = getScanQueue();

  await queue.add("manual-scan", payload, {
    jobId: payload.scanId,
    removeOnComplete: true,
    removeOnFail: true,
  });
};

export async function closeScanQueue(): Promise<void> {
  if (!scanQueue) {
    return;
  }

  await scanQueue.close();
  scanQueue = undefined;
}
