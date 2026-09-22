import {
  WORKER_HEALTH_KEY,
  WORKER_HEARTBEAT_STALE_MS,
  WorkerHealthSnapshotSchema,
  type WorkerHealthSnapshot,
} from "@agency-saas/contracts";
import { createDatabase } from "@agency-saas/db";
import { Redis } from "ioredis";

export type PublicReadiness = {
  status: "ready" | "degraded";
  checks: {
    database: "up" | "down";
    valkey: "up" | "down";
    worker: "up" | "down";
    queue: "up" | "down";
    browser: "up" | "down";
  };
  checkedAt: string;
};

type ValkeyProbeResult = {
  status: "up" | "down";
  heartbeat: string | null;
};

async function probeDatabase(): Promise<"up" | "down"> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return "down";

  const { client } = createDatabase(databaseUrl);
  try {
    await client`select 1 as healthy`;
    return "up";
  } catch {
    return "down";
  } finally {
    await client.end({ timeout: 1 });
  }
}

async function probeValkey(): Promise<ValkeyProbeResult> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return { status: "down", heartbeat: null };
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
    await redis.ping();
    return {
      status: "up",
      heartbeat: await redis.get(WORKER_HEALTH_KEY),
    };
  } catch {
    return { status: "down", heartbeat: null };
  } finally {
    redis.disconnect();
  }
}

export function parseFreshWorkerHeartbeat(
  raw: string | null,
  now = new Date(),
): WorkerHealthSnapshot | null {
  if (!raw) return null;

  try {
    const parsed = WorkerHealthSnapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;

    const heartbeatAge =
      now.getTime() - new Date(parsed.data.checkedAt).getTime();
    if (heartbeatAge < 0 || heartbeatAge > WORKER_HEARTBEAT_STALE_MS) {
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

export async function collectPublicReadiness(
  now = new Date(),
  probes: {
    database?: () => Promise<"up" | "down">;
    valkey?: () => Promise<ValkeyProbeResult>;
  } = {},
): Promise<PublicReadiness> {
  const [database, valkeyResult] = await Promise.all([
    (probes.database ?? probeDatabase)(),
    (probes.valkey ?? probeValkey)(),
  ]);

  const heartbeat =
    valkeyResult.status === "up"
      ? parseFreshWorkerHeartbeat(valkeyResult.heartbeat, now)
      : null;

  const checks: PublicReadiness["checks"] = {
    database,
    valkey: valkeyResult.status,
    worker: heartbeat ? "up" : "down",
    queue: heartbeat?.queue.status ?? "down",
    browser: heartbeat?.browser.status ?? "down",
  };

  const ready = Object.values(checks).every((status) => status === "up");

  return {
    status: ready ? "ready" : "degraded",
    checks,
    checkedAt: now.toISOString(),
  };
}
