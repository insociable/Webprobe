import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import {
  SCAN_QUEUE_NAME,
  ScanJobSchema,
  type ScanJob,
} from "@agency-saas/contracts";
import { closeScanQueue, enqueueScanJob } from "../scan-queue";

const describeRedis =
  process.env.RUN_REDIS_INTEGRATION === "1" ? describe : describe.skip;

function redisConnection() {
  const rawUrl = process.env.REDIS_URL;
  if (!rawUrl) {
    throw new Error("REDIS_URL is required for Redis integration tests");
  }

  const url = new URL(rawUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
  };
}

afterEach(async () => {
  await closeScanQueue();
});

describeRedis("scan queue producer", () => {
  it("enqueues the validated scan payload with the scan id as job id", async () => {
    const payload = ScanJobSchema.parse({
      scanId: randomUUID(),
      organizationId: randomUUID(),
      siteId: randomUUID(),
      targetUrl: "https://example.com/",
    });

    const observer = new Queue<ScanJob>(SCAN_QUEUE_NAME, {
      connection: redisConnection(),
    });

    try {
      await enqueueScanJob(payload);

      const job = await observer.getJob(payload.scanId);
      expect(job).not.toBeNull();
      expect(job?.id).toBe(payload.scanId);
      expect(job?.data).toEqual(payload);

      await job?.remove();
    } finally {
      await observer.close();
    }
  });
});
