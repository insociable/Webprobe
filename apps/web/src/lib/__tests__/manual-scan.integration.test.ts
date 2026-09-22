import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  memberships,
  organizations,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { and, eq, inArray } from "drizzle-orm";
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
  it("creates a queued scan and enqueues the persisted target", async () => {
    const fixture = await createFixture();
    const enqueued: unknown[] = [];

    try {
      const scan = await createManualScanForSite(
        fixture.ownerId,
        fixture.organizationId,
        fixture.activeSiteId,
        async (payload) => {
          enqueued.push(payload);
        },
      );

      expect(enqueued).toEqual([
        expect.objectContaining({
          scanId: scan.id,
          organizationId: fixture.organizationId,
          siteId: fixture.activeSiteId,
          targetUrl: "https://example.com/",
        }),
      ]);

      const persisted = await db
        .select({
          status: scans.status,
          trigger: scans.trigger,
        })
        .from(scans)
        .where(eq(scans.id, scan.id))
        .limit(1);

      expect(persisted[0]).toEqual({
        status: "queued",
        trigger: "manual",
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
          async () => {},
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
          async () => {},
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
          async () => {},
        ),
        createManualScanForSite(
          fixture.ownerId,
          fixture.organizationId,
          fixture.activeSiteId,
          async () => {},
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
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
      ]);
    }
  });

  it("removes a still-queued scan when enqueue fails", async () => {
    const fixture = await createFixture();

    try {
      await expect(
        createManualScanForSite(
          fixture.ownerId,
          fixture.organizationId,
          fixture.activeSiteId,
          async () => {
            throw new Error("redis unavailable detail");
          },
        ),
      ).rejects.toMatchObject({ code: "queue-unavailable" });

      const remaining = await db
        .select({ id: scans.id })
        .from(scans)
        .where(
          and(
            eq(scans.organizationId, fixture.organizationId),
            eq(scans.siteId, fixture.activeSiteId),
          ),
        );

      expect(remaining).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
      ]);
    }
  });
});
