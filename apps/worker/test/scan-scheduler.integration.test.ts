import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { organizations, scanSchedules, scans, sites } from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import {
  cancelInvalidQueuedScheduledScans,
  claimDueScheduledScans,
  dispatchQueuedScheduledScans,
  initializeMissingScheduleCursors,
  recoverOrphanedRunningScans,
} from "../src/scan-scheduler.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

afterAll(async () => {
  await closeDatabase();
});

async function createFixture(options?: {
  nextRunAt?: Date | null;
  enabled?: boolean;
}) {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const scheduleId = randomUUID();

  await db.insert(organizations).values({
    id: organizationId,
    name: "Scheduled scan test",
  });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Scheduled target",
    canonicalUrl: "https://example.com/",
    status: "active",
    verifiedAt: new Date(),
  });
  await db.insert(scanSchedules).values({
    id: scheduleId,
    organizationId,
    siteId,
    enabled: options?.enabled ?? true,
    dayOfWeek: 1,
    minuteOfDay: 9 * 60,
    timeZone: "Europe/Paris",
    nextRunAt: options?.nextRunAt,
  });

  return { organizationId, siteId, scheduleId };
}

async function deleteFixture(organizationId: string) {
  const { db } = getDatabase();
  await db.delete(organizations).where(eq(organizations.id, organizationId));
}
describeDatabase("scheduled scan coordinator persistence", () => {
  it("claims one due occurrence once across concurrent schedulers", async () => {
    const { db } = getDatabase();
    const now = new Date("2026-09-22T08:00:00.000Z");
    const dueAt = new Date("2026-09-22T07:55:00.000Z");
    const fixture = await createFixture({ nextRunAt: dueAt });

    try {
      const results = await Promise.all([
        claimDueScheduledScans(now),
        claimDueScheduledScans(now),
      ]);

      expect(
        results.reduce((total, result) => total + result.created.length, 0),
      ).toBe(1);

      const persisted = await db
        .select({
          trigger: scans.trigger,
          scheduleId: scans.scheduleId,
          scheduledFor: scans.scheduledFor,
          status: scans.status,
        })
        .from(scans)
        .where(eq(scans.siteId, fixture.siteId));

      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        trigger: "scheduled",
        scheduleId: fixture.scheduleId,
        scheduledFor: dueAt,
        status: "queued",
      });

      const [schedule] = await db
        .select({ nextRunAt: scanSchedules.nextRunAt })
        .from(scanSchedules)
        .where(eq(scanSchedules.id, fixture.scheduleId));
      expect(schedule?.nextRunAt?.getTime()).toBeGreaterThan(dueAt.getTime());
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("advances a due schedule without creating a second active scan", async () => {
    const { db } = getDatabase();
    const now = new Date("2026-09-22T08:00:00.000Z");
    const dueAt = new Date("2026-09-22T07:55:00.000Z");
    const fixture = await createFixture({ nextRunAt: dueAt });

    try {
      await db.insert(scans).values({
        organizationId: fixture.organizationId,
        siteId: fixture.siteId,
        trigger: "manual",
        status: "queued",
      });

      const result = await claimDueScheduledScans(now);
      expect(result).toMatchObject({ due: 1, skipped: 1 });
      expect(result.created).toHaveLength(0);
      const scheduledRows = await db
        .select({ id: scans.id })
        .from(scans)
        .where(eq(scans.trigger, "scheduled"));
      expect(scheduledRows).toHaveLength(0);

      const [schedule] = await db
        .select({ nextRunAt: scanSchedules.nextRunAt })
        .from(scanSchedules)
        .where(eq(scanSchedules.id, fixture.scheduleId));
      expect(schedule?.nextRunAt?.getTime()).toBeGreaterThan(dueAt.getTime());
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("keeps queued scheduled scans durable when enqueue fails", async () => {
    const { db } = getDatabase();
    const scheduledFor = new Date("2026-09-22T07:55:00.000Z");
    const fixture = await createFixture({
      nextRunAt: new Date("2026-09-29T07:00:00.000Z"),
    });

    try {
      const [scan] = await db
        .insert(scans)
        .values({
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          trigger: "scheduled",
          scheduleId: fixture.scheduleId,
          scheduledFor,
          status: "queued",
        })
        .returning({ id: scans.id });

      const failed = await dispatchQueuedScheduledScans(async () => {
        throw new Error("redis unavailable");
      });
      expect(failed).toEqual({ attempted: 1, enqueued: 0, failed: 1 });

      const [stillQueued] = await db
        .select({ status: scans.status })
        .from(scans)
        .where(eq(scans.id, scan!.id));
      expect(stillQueued?.status).toBe("queued");

      const delivered: string[] = [];
      const retried = await dispatchQueuedScheduledScans(async (payload) => {
        delivered.push(payload.scanId);
      });
      expect(retried).toEqual({ attempted: 1, enqueued: 1, failed: 0 });
      expect(delivered).toEqual([scan!.id]);
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("cancels queued work when its schedule becomes disabled", async () => {
    const { db } = getDatabase();
    const fixture = await createFixture({
      nextRunAt: new Date("2026-09-29T07:00:00.000Z"),
    });

    try {
      const [scan] = await db
        .insert(scans)
        .values({
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          trigger: "scheduled",
          scheduleId: fixture.scheduleId,
          scheduledFor: new Date("2026-09-22T07:55:00.000Z"),
          status: "queued",
        })
        .returning({ id: scans.id });

      await db
        .update(scanSchedules)
        .set({ enabled: false, nextRunAt: null })
        .where(eq(scanSchedules.id, fixture.scheduleId));

      expect(await cancelInvalidQueuedScheduledScans()).toBe(1);

      const [persisted] = await db
        .select({ status: scans.status, summary: scans.summary })
        .from(scans)
        .where(eq(scans.id, scan!.id));
      expect(persisted?.status).toBe("cancelled");
      expect(persisted?.summary).toMatchObject({
        cancellation: { code: "scheduled-context-invalid" },
      });
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("initializes legacy enabled schedules without firing them immediately", async () => {
    const { db } = getDatabase();
    const now = new Date("2026-09-22T08:00:00.000Z");
    const fixture = await createFixture({ nextRunAt: null });

    try {
      expect(await initializeMissingScheduleCursors(now)).toBe(1);

      const [schedule] = await db
        .select({ nextRunAt: scanSchedules.nextRunAt })
        .from(scanSchedules)
        .where(eq(scanSchedules.id, fixture.scheduleId));
      expect(schedule?.nextRunAt?.getTime()).toBeGreaterThan(now.getTime());

      const siteScans = await db
        .select({ id: scans.id })
        .from(scans)
        .where(eq(scans.siteId, fixture.siteId));
      expect(siteScans).toHaveLength(0);
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("recovers orphaned scheduled scans and fails orphaned manual scans", async () => {
    const { db } = getDatabase();
    const now = new Date("2026-09-22T08:00:00.000Z");
    const staleStartedAt = new Date("2026-09-22T07:30:00.000Z");
    const fixture = await createFixture({
      nextRunAt: new Date("2026-09-29T07:00:00.000Z"),
    });

    try {
      const [scheduledScan] = await db
        .insert(scans)
        .values({
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          trigger: "scheduled",
          scheduleId: fixture.scheduleId,
          scheduledFor: new Date("2026-09-22T07:00:00.000Z"),
          status: "running",
          startedAt: staleStartedAt,
        })
        .returning({ id: scans.id });

      const recovered = await recoverOrphanedRunningScans(
        async () => false,
        now,
      );
      expect(recovered).toEqual({
        checked: 1,
        recoveredScheduled: 1,
        failedManual: 0,
        inspectionFailed: 0,
      });

      const [scheduledPersisted] = await db
        .select({ status: scans.status, startedAt: scans.startedAt })
        .from(scans)
        .where(eq(scans.id, scheduledScan!.id));
      expect(scheduledPersisted).toEqual({
        status: "queued",
        startedAt: null,
      });

      await db.delete(scans).where(eq(scans.id, scheduledScan!.id));

      const [manualScan] = await db
        .insert(scans)
        .values({
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          trigger: "manual",
          status: "running",
          startedAt: staleStartedAt,
        })
        .returning({ id: scans.id });

      const failed = await recoverOrphanedRunningScans(async () => false, now);
      expect(failed).toEqual({
        checked: 1,
        recoveredScheduled: 0,
        failedManual: 1,
        inspectionFailed: 0,
      });

      const [manualPersisted] = await db
        .select({ status: scans.status, summary: scans.summary })
        .from(scans)
        .where(eq(scans.id, manualScan!.id));
      expect(manualPersisted?.status).toBe("failed");
      expect(manualPersisted?.summary).toMatchObject({
        error: { code: "stale-worker-job" },
      });
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("leaves stale running scans untouched when Redis inspection fails", async () => {
    const { db } = getDatabase();
    const now = new Date("2026-09-22T08:00:00.000Z");
    const fixture = await createFixture({
      nextRunAt: new Date("2026-09-29T07:00:00.000Z"),
    });

    try {
      const [scan] = await db
        .insert(scans)
        .values({
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          trigger: "manual",
          status: "running",
          startedAt: new Date("2026-09-22T07:30:00.000Z"),
        })
        .returning({ id: scans.id });

      const result = await recoverOrphanedRunningScans(async () => {
        throw new Error("redis unavailable");
      }, now);
      expect(result).toEqual({
        checked: 1,
        recoveredScheduled: 0,
        failedManual: 0,
        inspectionFailed: 1,
      });

      const [persisted] = await db
        .select({ status: scans.status })
        .from(scans)
        .where(eq(scans.id, scan!.id));
      expect(persisted?.status).toBe("running");
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("uses PostgreSQL timezone rules across DST transitions", async () => {
    const { client } = getDatabase();
    const spring = await client.unsafe<{ next_run: Date }[]>(
      "select public.next_weekly_scan_run(7, 150, 'Europe/Paris', '2027-03-27T12:00:00Z'::timestamptz) as next_run",
    );
    const autumn = await client.unsafe<{ next_run: Date }[]>(
      "select public.next_weekly_scan_run(7, 150, 'Europe/Paris', '2026-10-24T12:00:00Z'::timestamptz) as next_run",
    );

    expect(new Date(String(spring[0]?.next_run)).toISOString()).toBe(
      "2027-03-28T01:30:00.000Z",
    );
    expect(new Date(String(autumn[0]?.next_run)).toISOString()).toBe(
      "2026-10-25T01:30:00.000Z",
    );
  });
});
