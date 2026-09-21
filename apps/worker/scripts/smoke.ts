import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Queue, QueueEvents } from "bullmq";
import { SCAN_QUEUE_NAME } from "@agency-saas/contracts";

config({ path: new URL("../../../.env", import.meta.url) });

const redisUrl = new URL(process.env.REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
};

const events = new QueueEvents(SCAN_QUEUE_NAME, { connection });
const queue = new Queue(SCAN_QUEUE_NAME, { connection });

try {
  await events.waitUntilReady();
  const organizationId = randomUUID();
  const siteId = randomUUID();

  const publicJob = await queue.add("smoke-public", {
    scanId: randomUUID(),
    organizationId,
    siteId,
    targetUrl: "https://example.com",
  });
  const publicResult = await publicJob.waitUntilFinished(events, 10_000);

  const privateJob = await queue.add("smoke-private", {
    scanId: randomUUID(),
    organizationId,
    siteId,
    targetUrl: "http://127.0.0.1",
  });

  let privateTargetRejected = false;
  try {
    await privateJob.waitUntilFinished(events, 10_000);
  } catch {
    privateTargetRejected = true;
  }

  if (!privateTargetRejected) {
    throw new Error("Private target was unexpectedly accepted");
  }

  console.log(
    JSON.stringify({
      ok: true,
      publicTarget: publicResult.targetUrl,
      privateTargetRejected,
    }),
  );
} finally {
  await Promise.all([events.close(), queue.close()]);
}
