import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { type ScanJob } from "@agency-saas/contracts";
import { organizations, scanDispatches, scans, sites } from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import { parseRedisConnectionUrl } from "../src/redis-connection.js";
import { collectWorkerHealthSnapshot } from "../src/observability.js";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" &&
  process.env.RUN_REDIS_INTEGRATION === "1"
    ? describe
    : describe.skip;

function redisConnection() {
  return {
    ...parseRedisConnectionUrl(process.env.REDIS_URL),
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
  };
}

afterAll(async () => {
  await closeDatabase();
});

describeIntegration("worker observability", () => {
  it("reports DB/outbox and real BullMQ backlog metrics", async () => {
    const { db } = getDatabase();
    const queue = new Queue<ScanJob>(`observability-${randomUUID()}`, {
      connection: redisConnection(),
    });
    const now = new Date();
    const organizationId = randomUUID();
    const siteId = randomUUID();
    const queuedSiteId = randomUUID();
    const deepSiteId = randomUUID();
    const browser = {
      status: "up" as const,
      checkedAt: now.toISOString(),
    };

    const baseline = await collectWorkerHealthSnapshot(queue, browser, now);

    await db.insert(organizations).values({
      id: organizationId,
      name: "Observability test",
    });
    await db.insert(sites).values([
      {
        id: siteId,
        organizationId,
        name: "Metrics target",
        canonicalUrl: "https://example.com/",
        status: "active",
        verifiedAt: now,
      },
      {
        id: queuedSiteId,
        organizationId,
        name: "Queued target",
        canonicalUrl: "https://example.org/",
        status: "active",
        verifiedAt: now,
      },
      {
        id: deepSiteId,
        organizationId,
        name: "Deep metrics target",
        canonicalUrl: "https://example.net/",
        status: "active",
        verifiedAt: now,
      },
    ]);

    const [
      running,
      completed,
      failed,
      queued,
      deepRunning,
      deepCompleted,
      deepFailed,
    ] = await db
      .insert(scans)
      .values([
        {
          organizationId,
          siteId,
          trigger: "manual",
          status: "running",
          startedAt: new Date(now.getTime() - 60 * 60_000),
        },
        {
          organizationId,
          siteId,
          trigger: "manual",
          status: "completed",
          startedAt: new Date(now.getTime() - 10_000),
          completedAt: new Date(now.getTime() - 9_000),
        },
        {
          organizationId,
          siteId,
          trigger: "manual",
          status: "failed",
          startedAt: new Date(now.getTime() - 8_000),
          completedAt: new Date(now.getTime() - 6_000),
        },
        {
          organizationId,
          siteId: queuedSiteId,
          trigger: "manual",
          status: "queued",
        },
        {
          organizationId,
          siteId: deepSiteId,
          trigger: "manual",
          scanMode: "verified_deep_audit",
          status: "running",
          startedAt: new Date(now.getTime() - 60 * 60_000),
        },
        {
          organizationId,
          siteId: deepSiteId,
          trigger: "manual",
          scanMode: "verified_deep_audit",
          status: "completed",
          startedAt: new Date(now.getTime() - 10_000),
          completedAt: new Date(now.getTime() - 9_000),
        },
        {
          organizationId,
          siteId: deepSiteId,
          trigger: "manual",
          scanMode: "verified_deep_audit",
          status: "failed",
          startedAt: new Date(now.getTime() - 8_000),
          completedAt: new Date(now.getTime() - 6_000),
        },
      ])
      .returning({ id: scans.id });

    if (
      !running ||
      !completed ||
      !failed ||
      !queued ||
      !deepRunning ||
      !deepCompleted ||
      !deepFailed
    ) {
      throw new Error("observability fixture creation failed");
    }

    await db.insert(scanDispatches).values({
      scanId: queued.id,
      status: "pending",
      lastErrorCode: "ECONNRESET",
    });

    const payload = {
      scanId: randomUUID(),
      organizationId,
      siteId,
      targetUrl: "https://example.com/",
      profile: {
        maxPages: 20,
        navigationTimeoutMs: 20_000,
        checkAccessibility: true,
        captureScreenshots: true,
      },
    } satisfies ScanJob;

    try {
      await queue.add("waiting", payload, { jobId: randomUUID() });
      await queue.add(
        "delayed",
        { ...payload, scanId: randomUUID() },
        { jobId: randomUUID(), delay: 60_000 },
      );

      const snapshot = await collectWorkerHealthSnapshot(queue, browser, now);

      expect(snapshot.database.status).toBe("up");
      expect(snapshot.database.scansRunning).toBe(
        baseline.database.scansRunning + 2,
      );
      expect(snapshot.database.scansStale).toBe(
        baseline.database.scansStale + 2,
      );
      expect(snapshot.database.deepScansRunning).toBe(
        baseline.database.deepScansRunning + 1,
      );
      expect(snapshot.database.deepScansStale).toBe(
        baseline.database.deepScansStale + 1,
      );
      expect(snapshot.database.deepSuccessLast24h).toBe(
        baseline.database.deepSuccessLast24h + 1,
      );
      expect(snapshot.database.deepFailedLast24h).toBe(
        baseline.database.deepFailedLast24h + 1,
      );
      expect(snapshot.database.successLast24h).toBe(
        baseline.database.successLast24h + 2,
      );
      expect(snapshot.database.failedLast24h).toBe(
        baseline.database.failedLast24h + 2,
      );
      expect(snapshot.database.dispatchPending).toBe(
        baseline.database.dispatchPending + 1,
      );
      expect(snapshot.database.dispatchErrors).toBe(
        baseline.database.dispatchErrors + 1,
      );

      expect(snapshot.queue).toMatchObject({
        status: "up",
        waiting: 1,
        delayed: 1,
        backlog: 2,
      });
      expect(snapshot.queue.oldestPendingAgeMs).not.toBeNull();
      expect(snapshot.browser.status).toBe("up");
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  });
});
