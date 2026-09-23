import { describe, expect, it } from "vitest";
import { WorkerHealthSnapshotSchema } from "@agency-saas/contracts";
import {
  collectPublicReadiness,
  createReadinessCache,
  parseFreshWorkerHeartbeat,
} from "../health-readiness";

function heartbeat(checkedAt: string) {
  return WorkerHealthSnapshotSchema.parse({
    version: 1,
    checkedAt,
    database: {
      status: "up",
      scansRunning: 2,
      scansStale: 1,
      successLast24h: 8,
      failedLast24h: 2,
      successRateLast24h: 0.8,
      averageDurationMsLast24h: 1250,
      dispatchPending: 1,
      dispatchErrors: 0,
    },
    queue: {
      status: "up",
      waiting: 1,
      active: 1,
      delayed: 0,
      failed: 0,
      backlog: 1,
      oldestPendingAgeMs: 500,
    },
    browser: {
      status: "up",
      checkedAt,
    },
  });
}

describe("health readiness", () => {
  it("coalesces concurrent probes and refreshes after the short TTL", async () => {
    let now = 1_000;
    let calls = 0;
    const readiness = {
      status: "degraded" as const,
      checks: {
        database: "down" as const,
        valkey: "down" as const,
        worker: "down" as const,
        queue: "down" as const,
        browser: "down" as const,
      },
      checkedAt: "2026-09-22T18:00:00.000Z",
    };
    const cached = createReadinessCache(
      async () => {
        calls += 1;
        await Promise.resolve();
        return readiness;
      },
      5_000,
      () => now,
    );
    await Promise.all(Array.from({ length: 30 }, () => cached()));
    expect(calls).toBe(1);
    await cached();
    expect(calls).toBe(1);
    now += 5_001;
    await cached();
    expect(calls).toBe(2);
  });
  it("accepts a fresh worker heartbeat", () => {
    const now = new Date("2026-09-22T18:00:20.000Z");
    const raw = JSON.stringify(heartbeat("2026-09-22T18:00:00.000Z"));

    expect(parseFreshWorkerHeartbeat(raw, now)?.queue.backlog).toBe(1);
  });

  it("rejects stale and malformed heartbeats", () => {
    const now = new Date("2026-09-22T18:02:00.000Z");
    const stale = JSON.stringify(heartbeat("2026-09-22T18:00:00.000Z"));

    expect(parseFreshWorkerHeartbeat(stale, now)).toBeNull();
    expect(parseFreshWorkerHeartbeat("{not-json", now)).toBeNull();
  });

  it("returns only public component status when fully ready", async () => {
    const now = new Date("2026-09-22T18:00:20.000Z");
    const raw = JSON.stringify(heartbeat("2026-09-22T18:00:00.000Z"));

    const result = await collectPublicReadiness(now, {
      database: async () => "up",
      valkey: async () => ({ status: "up", heartbeat: raw }),
    });

    expect(result).toEqual({
      status: "ready",
      checks: {
        database: "up",
        valkey: "up",
        worker: "up",
        queue: "up",
        browser: "up",
      },
      checkedAt: now.toISOString(),
    });
    expect(JSON.stringify(result)).not.toContain("scansRunning");
    expect(JSON.stringify(result)).not.toContain("backlog");
  });

  it("fails readiness closed when the worker heartbeat is stale", async () => {
    const now = new Date("2026-09-22T18:02:00.000Z");
    const stale = JSON.stringify(heartbeat("2026-09-22T18:00:00.000Z"));

    const result = await collectPublicReadiness(now, {
      database: async () => "up",
      valkey: async () => ({ status: "up", heartbeat: stale }),
    });

    expect(result.status).toBe("degraded");
    expect(result.checks).toMatchObject({
      database: "up",
      valkey: "up",
      worker: "down",
      queue: "down",
      browser: "down",
    });
  });
});
