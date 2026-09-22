import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  notificationDeliveries,
  organizations,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import {
  claimDueNotificationDeliveries,
  dispatchDueNotificationDeliveries,
} from "../src/notification-delivery.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

afterAll(async () => {
  await closeDatabase();
});

async function createFixture() {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const scanId = randomUUID();
  const userId = randomUUID();
  const deliveryId = randomUUID();

  await db.insert(users).values({
    id: userId,
    email: `delivery-${userId}@example.invalid`,
    displayName: "Delivery recipient",
    emailVerified: true,
  });
  await db.insert(organizations).values({
    id: organizationId,
    name: "Notification delivery test",
  });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Delivery target",
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
    completedAt: new Date("2026-09-22T09:00:00.000Z"),
  });
  await db.insert(notificationDeliveries).values({
    id: deliveryId,
    organizationId,
    siteId,
    scanId,
    recipientUserId: userId,
    recipientEmail: `delivery-${userId}@example.invalid`,
    payload: {
      degradations: [
        {
          change: "new",
          fingerprint: "f".repeat(64),
          severity: "high",
          previousSeverity: null,
          code: "availability.http-5xx",
          title: "Le site retourne une erreur serveur",
          pageUrl: "https://example.com/",
        },
      ],
    },
    nextAttemptAt: new Date("2026-09-22T09:00:00.000Z"),
  });

  return { organizationId, deliveryId };
}

async function deleteFixture(organizationId: string) {
  const { db } = getDatabase();
  await db.delete(organizations).where(eq(organizations.id, organizationId));
}

describeDatabase("notification delivery outbox", () => {
  it("claims a due delivery only once across concurrent workers", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-09-22T09:01:00.000Z");

    try {
      const results = await Promise.all([
        claimDueNotificationDeliveries(now),
        claimDueNotificationDeliveries(now),
      ]);

      expect(results.flat()).toHaveLength(1);
      expect(results.flat()[0]).toMatchObject({
        id: fixture.deliveryId,
        attemptCount: 1,
      });

      const { db } = getDatabase();
      const [row] = await db
        .select({
          status: notificationDeliveries.status,
          attemptCount: notificationDeliveries.attemptCount,
          leaseUntil: notificationDeliveries.leaseUntil,
        })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, fixture.deliveryId));

      expect(row?.status).toBe("sending");
      expect(row?.attemptCount).toBe(1);
      expect(row?.leaseUntil?.getTime()).toBeGreaterThan(now.getTime());
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("returns failed sends to pending with exponential retry state", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-09-22T09:01:00.000Z");

    try {
      const result = await dispatchDueNotificationDeliveries(async () => {
        const error = new Error("SMTP unavailable") as Error & {
          code: string;
        };
        error.code = "ECONNREFUSED";
        throw error;
      }, now);

      expect(result).toEqual({ attempted: 1, sent: 0, failed: 1 });

      const { db } = getDatabase();
      const [row] = await db
        .select({
          status: notificationDeliveries.status,
          attemptCount: notificationDeliveries.attemptCount,
          nextAttemptAt: notificationDeliveries.nextAttemptAt,
          leaseUntil: notificationDeliveries.leaseUntil,
          lastErrorCode: notificationDeliveries.lastErrorCode,
        })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, fixture.deliveryId));

      expect(row).toMatchObject({
        status: "pending",
        attemptCount: 1,
        leaseUntil: null,
        lastErrorCode: "ECONNREFUSED",
      });
      expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("recovers an expired sending lease and marks a successful retry sent", async () => {
    const fixture = await createFixture();
    const { db } = getDatabase();
    const now = new Date("2026-09-22T10:00:00.000Z");

    try {
      await db
        .update(notificationDeliveries)
        .set({
          status: "sending",
          attemptCount: 1,
          leaseUntil: new Date("2026-09-22T09:59:00.000Z"),
        })
        .where(eq(notificationDeliveries.id, fixture.deliveryId));

      const sentIds: string[] = [];
      const result = await dispatchDueNotificationDeliveries(
        async (delivery) => {
          sentIds.push(delivery.id);
        },
        now,
      );

      expect(result).toEqual({ attempted: 1, sent: 1, failed: 0 });
      expect(sentIds).toEqual([fixture.deliveryId]);

      const [row] = await db
        .select({
          status: notificationDeliveries.status,
          attemptCount: notificationDeliveries.attemptCount,
          sentAt: notificationDeliveries.sentAt,
          leaseUntil: notificationDeliveries.leaseUntil,
        })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, fixture.deliveryId));

      expect(row?.status).toBe("sent");
      expect(row?.attemptCount).toBe(2);
      expect(row?.sentAt).toBeInstanceOf(Date);
      expect(row?.leaseUntil).toBeNull();
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });
});
