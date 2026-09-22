import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  organizations,
  reportDeliveries,
  reportShares,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import {
  claimDueReportDeliveries,
  dispatchDueReportDeliveries,
} from "../src/report-delivery.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

afterAll(async () => {
  await closeDatabase();
});

async function createFixture(
  options: {
    expiresAt?: Date;
    revokedAt?: Date | null;
  } = {},
) {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const scanId = randomUUID();
  const userId = randomUUID();
  const shareId = randomUUID();
  const deliveryId = randomUUID();

  await db.insert(users).values({
    id: userId,
    email: "report-worker-" + userId + "@example.invalid",
    displayName: "Report worker owner",
  });
  await db.insert(organizations).values({
    id: organizationId,
    name: "Worker Agency",
    reportBrandName: "Branded Agency",
    reportAccentColor: "#123abc",
  });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Worker Client Site",
    canonicalUrl: "https://example.com/",
    status: "active",
    verifiedAt: new Date(),
  });
  await db.insert(scans).values({
    id: scanId,
    organizationId,
    siteId,
    trigger: "manual",
    status: "completed",
    completedAt: new Date("2026-09-22T12:00:00.000Z"),
  });
  await db.insert(reportShares).values({
    id: shareId,
    organizationId,
    siteId,
    scanId,
    tokenHash: "d".repeat(64),
    tokenCiphertext: "encrypted-test-token",
    expiresAt: options.expiresAt ?? new Date("2026-10-01T12:00:00.000Z"),
    revokedAt: options.revokedAt ?? null,
    createdByUserId: userId,
    createdAt: new Date("2026-09-22T11:00:00.000Z"),
  });
  await db.insert(reportDeliveries).values({
    id: deliveryId,
    reportShareId: shareId,
    organizationId,
    siteId,
    scanId,
    recipientEmail: "client@example.com",
    nextAttemptAt: new Date("2026-09-22T12:00:00.000Z"),
  });

  return { organizationId, userId, deliveryId };
}

async function cleanup(organizationId: string, userId: string) {
  const { db } = getDatabase();
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(eq(users.id, userId));
}
describeDatabase("branded report delivery outbox", () => {
  it("claims a due report only once across concurrent coordinators", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-09-22T12:01:00.000Z");

    try {
      const [first, second] = await Promise.all([
        claimDueReportDeliveries(now),
        claimDueReportDeliveries(now),
      ]);

      expect([...first.deliveries, ...second.deliveries]).toHaveLength(1);
      expect(first.cancelled + second.cancelled).toBe(0);
    } finally {
      await cleanup(fixture.organizationId, fixture.userId);
    }
  });

  it("marks a successfully sent report and exposes persisted branding to the sender", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-09-22T12:01:00.000Z");
    const brands: string[] = [];

    try {
      const result = await dispatchDueReportDeliveries(async (delivery) => {
        brands.push(delivery.brandName);
      }, now);

      expect(result).toEqual({
        attempted: 1,
        sent: 1,
        failed: 0,
        cancelled: 0,
      });
      expect(brands).toEqual(["Branded Agency"]);

      const { db } = getDatabase();
      const [row] = await db
        .select({
          status: reportDeliveries.status,
          sentAt: reportDeliveries.sentAt,
        })
        .from(reportDeliveries)
        .where(eq(reportDeliveries.id, fixture.deliveryId));

      expect(row?.status).toBe("sent");
      expect(row?.sentAt).toBeInstanceOf(Date);
    } finally {
      await cleanup(fixture.organizationId, fixture.userId);
    }
  });
  it("returns SMTP failures to pending with retry metadata", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-09-22T12:01:00.000Z");

    try {
      const result = await dispatchDueReportDeliveries(async () => {
        const error = new Error("SMTP unavailable") as Error & {
          code: string;
        };
        error.code = "ECONNREFUSED";
        throw error;
      }, now);

      expect(result).toEqual({
        attempted: 1,
        sent: 0,
        failed: 1,
        cancelled: 0,
      });

      const { db } = getDatabase();
      const [row] = await db
        .select({
          status: reportDeliveries.status,
          attemptCount: reportDeliveries.attemptCount,
          lastErrorCode: reportDeliveries.lastErrorCode,
          nextAttemptAt: reportDeliveries.nextAttemptAt,
        })
        .from(reportDeliveries)
        .where(eq(reportDeliveries.id, fixture.deliveryId));

      expect(row).toMatchObject({
        status: "pending",
        attemptCount: 1,
        lastErrorCode: "ECONNREFUSED",
      });
      expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    } finally {
      await cleanup(fixture.organizationId, fixture.userId);
    }
  });

  it("cancels delivery when its share expired before send", async () => {
    const fixture = await createFixture({
      expiresAt: new Date("2026-09-22T11:59:00.000Z"),
    });
    const now = new Date("2026-09-22T12:01:00.000Z");

    try {
      const result = await dispatchDueReportDeliveries(async () => {
        throw new Error("sender must not run");
      }, now);

      expect(result).toEqual({
        attempted: 0,
        sent: 0,
        failed: 0,
        cancelled: 1,
      });

      const { db } = getDatabase();
      const [row] = await db
        .select({ status: reportDeliveries.status })
        .from(reportDeliveries)
        .where(eq(reportDeliveries.id, fixture.deliveryId));
      expect(row?.status).toBe("cancelled");
    } finally {
      await cleanup(fixture.organizationId, fixture.userId);
    }
  });
});
