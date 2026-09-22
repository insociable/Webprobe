import { config } from "dotenv";
import {
  WORKER_HEALTH_KEY,
  WORKER_HEARTBEAT_STALE_MS,
  WorkerHealthSnapshotSchema,
} from "@agency-saas/contracts";
import { Redis } from "ioredis";

config({ path: new URL("../../../.env", import.meta.url) });

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) {
  throw new Error("REDIS_URL is required");
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
  const raw = await redis.get(WORKER_HEALTH_KEY);
  if (!raw) {
    throw new Error("No worker health heartbeat is currently available");
  }

  const parsed = WorkerHealthSnapshotSchema.parse(JSON.parse(raw));
  const ageMs = Date.now() - new Date(parsed.checkedAt).getTime();

  process.stdout.write(
    JSON.stringify(
      {
        ...parsed,
        heartbeatAgeMs: ageMs,
        heartbeatFresh: ageMs >= 0 && ageMs <= WORKER_HEARTBEAT_STALE_MS,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  redis.disconnect();
}
