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

let healthDatabase: ReturnType<typeof createDatabase> | null = null;

async function probeDatabase(): Promise<"up" | "down"> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return "down";

  try {
    healthDatabase ??= createDatabase(databaseUrl);
    await healthDatabase.client`select 1 as healthy`;
    return "up";
  } catch {
    if (healthDatabase) {
      await healthDatabase.client.end({ timeout: 1 }).catch(() => undefined);
      healthDatabase = null;
    }
    return "down";
  }
}

let healthRedis: Redis | null = null;

function getHealthRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return null;

  if (!healthRedis || healthRedis.status === "end") {
    healthRedis = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
  }
  return healthRedis;
}

async function probeValkey(): Promise<ValkeyProbeResult> {
  const redis = getHealthRedis();
  if (!redis) {
    return { status: "down", heartbeat: null };
  }

  try {
    if (redis.status === "wait") {
      await redis.connect();
    }
    await redis.ping();
    return {
      status: "up",
      heartbeat: await redis.get(WORKER_HEALTH_KEY),
    };
  } catch {
    redis.disconnect();
    healthRedis = null;
    return { status: "down", heartbeat: null };
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

const readinessCacheTtlMs = 2_000;
let cachedReadiness: { expiresAt: number; value: PublicReadiness } | undefined;
let readinessInFlight: Promise<PublicReadiness> | undefined;

async function collectReadiness(
  now: Date,
  probes: {
    database?: () => Promise<"up" | "down">;
    valkey?: () => Promise<ValkeyProbeResult>;
  },
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

export async function collectPublicReadiness(
  now = new Date(),
  probes: {
    database?: () => Promise<"up" | "down">;
    valkey?: () => Promise<ValkeyProbeResult>;
  } = {},
): Promise<PublicReadiness> {
  const hasCustomProbes = Boolean(probes.database || probes.valkey);
  if (hasCustomProbes) {
    return collectReadiness(now, probes);
  }

  const nowMs = now.getTime();
  if (cachedReadiness && cachedReadiness.expiresAt > nowMs) {
    return cachedReadiness.value;
  }
  if (readinessInFlight) {
    return readinessInFlight;
  }

  readinessInFlight = collectReadiness(now, {})
    .then((value) => {
      cachedReadiness = {
        expiresAt: Date.now() + readinessCacheTtlMs,
        value,
      };
      return value;
    })
    .finally(() => {
      readinessInFlight = undefined;
    });

  return readinessInFlight;
}
