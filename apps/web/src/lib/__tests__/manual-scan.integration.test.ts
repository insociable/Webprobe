import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  memberships,
  organizations,
  scanDispatches,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { eq, inArray } from "drizzle-orm";
import { db } from "../database";
import { createManualScanForSite, ManualScanError } from "../manual-scan";
import { OrganizationAccessError } from "../organization-site-service";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

async function createFixture() {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const organizationId = randomUUID();
  const activeSiteId = randomUUID();
  const pendingSiteId = randomUUID();

  await db.insert(users).values([
    {
      id: ownerId,
      email: `scan-owner-${ownerId}@example.invalid`,
      displayName: "Scan Owner",
    },
    {
      id: memberId,
      email: `scan-member-${memberId}@example.invalid`,
      displayName: "Scan Member",
    },
  ]);

  await db.insert(organizations).values({
    id: organizationId,
    name: "Manual Scan Agency",
  });

  await db.insert(memberships).values([
    {
      organizationId,
      userId: ownerId,
      role: "owner",
    },
    {
      organizationId,
      userId: memberId,
      role: "member",
    },
  ]);

  await db.insert(sites).values([
    {
      id: activeSiteId,
      organizationId,
      name: "Active Site",
      canonicalUrl: "https://example.com/",
      status: "active",
      verifiedAt: new Date(),
    },
    {
      id: pendingSiteId,
      organizationId,
      name: "Pending Site",
      canonicalUrl: "https://example.org/",
      status: "pending_verification",
    },
  ]);

  return {
    ownerId,
    memberId,
    organizationId,
    activeSiteId,
    pendingSiteId,
  };
}

async function cleanupFixture(organizationId: string, userIds: string[]) {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(inArray(users.id, userIds));
}

describeDatabase("manual scan creation", () => {
  it("commits the queued scan and durable dispatch intent atomically", async () => {
    const fixture = await createFixture();

    try {
      const scan = await createManualScanForSite(
        fixture.ownerId,
        fixture.organizationId,
        fixture.activeSiteId,
      );

      const [persisted] = await db
        .select({
          status: scans.status,
          trigger: scans.trigger,
        })
        .from(scans)
        .where(eq(scans.id, scan.id))
        .limit(1);

      const [dispatch] = await db
        .select({
          status: scanDispatches.status,
          attemptCount: scanDispatches.attemptCount,
        })
        .from(scanDispatches)
        .where(eq(scanDispatches.scanId, scan.id))
        .limit(1);

      expect(persisted).toEqual({
        status: "queued",
        trigger: "manual",
      });
      expect(dispatch).toEqual({
        status: "pending",
        attemptCount: 0,
      });
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
      ]);
    }
  });

  it("rejects scans from ordinary members", async () => {
    const fixture = await createFixture();

    try {
      await expect(
        createManualScanForSite(
          fixture.memberId,
          fixture.organizationId,
          fixture.activeSiteId,
        ),
      ).rejects.toBeInstanceOf(OrganizationAccessError);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
      ]);
    }
  });

  it("rejects unverified sites", async () => {
    const fixture = await createFixture();

    try {
      await expect(
        createManualScanForSite(
          fixture.ownerId,
          fixture.organizationId,
          fixture.pendingSiteId,
        ),
      ).rejects.toMatchObject({
        code: "site-not-active",
      } satisfies Partial<ManualScanError>);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
      ]);
    }
  });

  it("allows only one queued or running scan per site", async () => {
    const fixture = await createFixture();

    try {
      const results = await Promise.allSettled([
        createManualScanForSite(
          fixture.ownerId,
          fixture.organizationId,
          fixture.activeSiteId,
        ),
        createManualScanForSite(
          fixture.ownerId,
          fixture.organizationId,
          fixture.activeSiteId,
        ),
      ]);

      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter((result) => result.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejectedResult = rejected[0];
      if (rejectedResult?.status !== "rejected") {
        throw new Error("Expected one rejected scan request");
      }
      expect(rejectedResult.reason).toMatchObject({
        code: "scan-already-running",
      });

      const [scan] = fulfilled;
      if (scan?.status !== "fulfilled") {
        throw new Error("Expected one committed scan");
      }
      const dispatches = await db
        .select({ scanId: scanDispatches.scanId })
        .from(scanDispatches)
        .where(eq(scanDispatches.scanId, scan.value.id));
      expect(dispatches).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
      ]);
    }
  });

  it("enforces the manual scan hourly site quota transactionally", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-09-22T12:00:00.000Z");

    try {
      await db.insert(scans).values(
        Array.from({ length: 6 }, (_, index) => ({
          organizationId: fixture.organizationId,
          siteId: fixture.activeSiteId,
          trigger: "manual" as const,
          status: "completed" as const,
          queuedAt: new Date(now.getTime() - index * 5 * 60_000),
          completedAt: new Date(now.getTime() - index * 5 * 60_000 + 30_000),
        })),
      );

      await expect(
        createManualScanForSite(
          fixture.ownerId,
          fixture.organizationId,
          fixture.activeSiteId,
          now,
        ),
      ).rejects.toMatchObject({
        code: "scan-rate-limited",
      } satisfies Partial<ManualScanError>);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
      ]);
    }
  });
});
