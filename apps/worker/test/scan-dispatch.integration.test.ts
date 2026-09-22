import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { SCAN_QUEUE_NAME, type ScanJob } from "@agency-saas/contracts";
import {
  organizations,
  scanAttempts,
  scanDispatches,
  scanSchedules,
  scans,
  sites,
} from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import {
  dispatchDueScanJobs,
  reconcileQueuedScanDispatches,
} from "../src/scan-dispatch.js";
import { recoverOrphanedRunningScans } from "../src/scan-scheduler.js";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" &&
  process.env.RUN_REDIS_INTEGRATION === "1"
    ? describe
    : describe.skip;

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

async function createFixture() {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();

  await db.insert(organizations).values({
    id: organizationId,
    name: "Dispatch reliability test",
  });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Dispatch target",
    canonicalUrl: "https://example.com/",
    status: "active",
    verifiedAt: new Date(),
  });
  const [scan] = await db
    .insert(scans)
    .values({
      organizationId,
      siteId,
      trigger: "manual",
      status: "queued",
    })
    .returning({ id: scans.id });
  if (!scan) throw new Error("fixture scan creation failed");

  await db.insert(scanDispatches).values({ scanId: scan.id });
  return { organizationId, siteId, scanId: scan.id };
}

async function deleteFixture(organizationId: string) {
  const { db } = getDatabase();
  await db.delete(organizations).where(eq(organizations.id, organizationId));
}

afterAll(async () => {
  await closeDatabase();
});

describeIntegration("scan dispatch transactional outbox", () => {
  it("dispatches a pending DB intent when no queue job exists", async () => {
    const fixture = await createFixture();
    const queue = new Queue<ScanJob>(SCAN_QUEUE_NAME, {
      connection: redisConnection(),
    });

    try {
      await queue.pause();
      const result = await dispatchDueScanJobs(async (payload) => {
        await queue.add("scan-test", payload, { jobId: payload.scanId });
      });

      expect(result).toMatchObject({
        attempted: 1,
        dispatched: 1,
        deferred: 0,
      });
      expect(await queue.getJob(fixture.scanId)).not.toBeNull();

      const { db } = getDatabase();
      const [dispatch] = await db
        .select({
          status: scanDispatches.status,
          attemptCount: scanDispatches.attemptCount,
        })
        .from(scanDispatches)
        .where(eq(scanDispatches.scanId, fixture.scanId));
      expect(dispatch).toEqual({ status: "dispatched", attemptCount: 1 });
    } finally {
      await (await queue.getJob(fixture.scanId))?.remove();
      await queue.resume();
      await queue.close();
      await deleteFixture(fixture.organizationId);
    }
  });

  it("survives BullMQ acceptance followed by a lost response without duplicate work", async () => {
    const fixture = await createFixture();
    const queue = new Queue<ScanJob>(SCAN_QUEUE_NAME, {
      connection: redisConnection(),
    });
    let loseResponse = true;

    try {
      await queue.pause();
      const enqueue = async (payload: ScanJob) => {
        await queue.add("scan-test", payload, { jobId: payload.scanId });
        if (loseResponse) {
          loseResponse = false;
          throw Object.assign(new Error("simulated lost queue response"), {
            code: "ECONNRESET",
          });
        }
      };

      const first = await dispatchDueScanJobs(enqueue);
      expect(first).toMatchObject({
        attempted: 1,
        dispatched: 0,
        deferred: 1,
      });

      const { db } = getDatabase();
      const [afterLoss] = await db
        .select({
          scanStatus: scans.status,
          dispatchStatus: scanDispatches.status,
        })
        .from(scans)
        .innerJoin(scanDispatches, eq(scanDispatches.scanId, scans.id))
        .where(eq(scans.id, fixture.scanId));
      expect(afterLoss).toEqual({
        scanStatus: "queued",
        dispatchStatus: "pending",
      });
      expect(await queue.getJob(fixture.scanId)).not.toBeNull();

      await db
        .update(scanDispatches)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(scanDispatches.scanId, fixture.scanId));

      const second = await dispatchDueScanJobs(enqueue);
      expect(second).toMatchObject({
        attempted: 1,
        dispatched: 1,
        deferred: 0,
      });

      const matching = (
        await queue.getJobs(["waiting", "paused", "delayed", "active"])
      ).filter((job) => job.id === fixture.scanId);
      expect(matching).toHaveLength(1);
    } finally {
      await (await queue.getJob(fixture.scanId))?.remove();
      await queue.resume();
      await queue.close();
      await deleteFixture(fixture.organizationId);
    }
  });

  it("claims a dispatch only once across concurrent dispatchers", async () => {
    const fixture = await createFixture();
    const delivered: string[] = [];

    try {
      const results = await Promise.all([
        dispatchDueScanJobs(async (payload) => {
          delivered.push(payload.scanId);
        }),
        dispatchDueScanJobs(async (payload) => {
          delivered.push(payload.scanId);
        }),
      ]);

      expect(results.reduce((sum, item) => sum + item.attempted, 0)).toBe(1);
      expect(delivered).toEqual([fixture.scanId]);
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("cancels a scheduled dispatch if its schedule was disabled before enqueue", async () => {
    const { db } = getDatabase();
    const organizationId = randomUUID();
    const siteId = randomUUID();
    const scheduleId = randomUUID();

    await db.insert(organizations).values({
      id: organizationId,
      name: "Disabled schedule dispatch test",
    });
    await db.insert(sites).values({
      id: siteId,
      organizationId,
      name: "Disabled scheduled target",
      canonicalUrl: "https://example.net/",
      status: "active",
      verifiedAt: new Date(),
    });
    await db.insert(scanSchedules).values({
      id: scheduleId,
      organizationId,
      siteId,
      enabled: false,
      dayOfWeek: 1,
      minuteOfDay: 600,
      timeZone: "Europe/Paris",
    });
    const [scan] = await db
      .insert(scans)
      .values({
        organizationId,
        siteId,
        trigger: "scheduled",
        scheduleId,
        scheduledFor: new Date("2026-09-22T08:00:00.000Z"),
        status: "queued",
      })
      .returning({ id: scans.id });
    if (!scan) throw new Error("fixture scan creation failed");
    await db.insert(scanDispatches).values({ scanId: scan.id });

    let enqueueCalled = false;
    try {
      const result = await dispatchDueScanJobs(async () => {
        enqueueCalled = true;
      });

      expect(result).toMatchObject({
        attempted: 0,
        dispatched: 0,
        deferred: 0,
        cancelled: 1,
      });
      expect(enqueueCalled).toBe(false);

      const [persisted] = await db
        .select({
          scanStatus: scans.status,
          dispatchStatus: scanDispatches.status,
        })
        .from(scans)
        .innerJoin(scanDispatches, eq(scanDispatches.scanId, scans.id))
        .where(eq(scans.id, scan.id));
      expect(persisted).toEqual({
        scanStatus: "cancelled",
        dispatchStatus: "cancelled",
      });
    } finally {
      await deleteFixture(organizationId);
    }
  });

  it("restores a dispatched queued scan when its BullMQ job is missing", async () => {
    const fixture = await createFixture();
    const { db } = getDatabase();

    try {
      await db
        .update(scanDispatches)
        .set({
          status: "dispatched",
          dispatchedAt: new Date(),
        })
        .where(eq(scanDispatches.scanId, fixture.scanId));

      const result = await reconcileQueuedScanDispatches(async () => false);
      expect(result).toEqual({
        checked: 1,
        restored: 1,
        inspectionFailed: 0,
      });

      const [dispatch] = await db
        .select({
          status: scanDispatches.status,
          lastErrorCode: scanDispatches.lastErrorCode,
        })
        .from(scanDispatches)
        .where(eq(scanDispatches.scanId, fixture.scanId));
      expect(dispatch).toEqual({
        status: "pending",
        lastErrorCode: "queue-job-missing",
      });
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("recovers a stale running scan only after its real BullMQ job disappears", async () => {
    const fixture = await createFixture();
    const { db } = getDatabase();
    const queue = new Queue<ScanJob>(SCAN_QUEUE_NAME, {
      connection: redisConnection(),
    });
    const staleStartedAt = new Date("2026-09-22T06:00:00.000Z");
    const recoveryNow = new Date("2026-09-22T08:00:00.000Z");

    try {
      await queue.pause();
      await db
        .update(scans)
        .set({ status: "running", startedAt: staleStartedAt })
        .where(eq(scans.id, fixture.scanId));
      await db
        .update(scanDispatches)
        .set({ status: "dispatched", dispatchedAt: staleStartedAt })
        .where(eq(scanDispatches.scanId, fixture.scanId));
      await db.insert(scanAttempts).values({
        scanId: fixture.scanId,
        attemptNumber: 1,
        status: "running",
        startedAt: staleStartedAt,
      });
      await queue.add(
        "scan-recovery-test",
        {
          scanId: fixture.scanId,
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          targetUrl: "https://example.com/",
          profile: {
            maxPages: 20,
            navigationTimeoutMs: 20_000,
            checkAccessibility: true,
            captureScreenshots: true,
          },
        },
        { jobId: fixture.scanId },
      );

      const whilePresent = await recoverOrphanedRunningScans(
        async (scanId) => (await queue.getJob(scanId)) !== undefined,
        recoveryNow,
      );
      expect(whilePresent).toEqual({
        checked: 1,
        recovered: 0,
        failed: 0,
        inspectionFailed: 0,
      });

      await (await queue.getJob(fixture.scanId))?.remove();

      const afterRemoval = await recoverOrphanedRunningScans(
        async (scanId) => (await queue.getJob(scanId)) !== undefined,
        recoveryNow,
      );
      expect(afterRemoval).toEqual({
        checked: 1,
        recovered: 1,
        failed: 0,
        inspectionFailed: 0,
      });

      const [persisted] = await db
        .select({
          scanStatus: scans.status,
          dispatchStatus: scanDispatches.status,
          dispatchError: scanDispatches.lastErrorCode,
        })
        .from(scans)
        .innerJoin(scanDispatches, eq(scanDispatches.scanId, scans.id))
        .where(eq(scans.id, fixture.scanId));
      expect(persisted).toEqual({
        scanStatus: "queued",
        dispatchStatus: "pending",
        dispatchError: "stale-worker-job",
      });
    } finally {
      await (await queue.getJob(fixture.scanId))?.remove();
      await queue.resume();
      await queue.close();
      await deleteFixture(fixture.organizationId);
    }
  });

  it("does not mutate dispatch state when queue inspection itself fails", async () => {
    const fixture = await createFixture();
    const { db } = getDatabase();

    try {
      await db
        .update(scanDispatches)
        .set({ status: "dispatched", dispatchedAt: new Date() })
        .where(eq(scanDispatches.scanId, fixture.scanId));

      const result = await reconcileQueuedScanDispatches(async () => {
        throw new Error("redis unavailable");
      });
      expect(result).toEqual({
        checked: 1,
        restored: 0,
        inspectionFailed: 1,
      });

      const [dispatch] = await db
        .select({ status: scanDispatches.status })
        .from(scanDispatches)
        .where(eq(scanDispatches.scanId, fixture.scanId));
      expect(dispatch?.status).toBe("dispatched");
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });
});
