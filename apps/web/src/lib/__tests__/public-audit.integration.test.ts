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
import { OrganizationAccessError } from "../organization-site-service";
import { createPublicAuditForSite, PublicAuditError } from "../public-audit";
import type { PublicAuditLimits } from "../public-audit-policy";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

const relaxedLimits: PublicAuditLimits = {
  userHourlyLimit: 100,
  userConcurrentLimit: 10,
  domainCooldownMs: 1,
};

async function createFixture() {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  const organizationId = randomUUID();
  const pendingSiteId = randomUUID();
  const sameDomainSiteId = randomUUID();
  const otherSiteId = randomUUID();
  const domainToken = randomUUID().replaceAll("-", "");
  const primaryHostname = `${domainToken}.example.com`;
  const otherHostname = `${domainToken}.example.org`;

  await db.insert(users).values([
    {
      id: ownerId,
      email: `public-owner-${ownerId}@example.invalid`,
      displayName: "Public Audit Owner",
    },
    {
      id: memberId,
      email: `public-member-${memberId}@example.invalid`,
      displayName: "Public Audit Member",
    },
    {
      id: outsiderId,
      email: `public-outsider-${outsiderId}@example.invalid`,
      displayName: "Public Audit Outsider",
    },
  ]);

  await db.insert(organizations).values({
    id: organizationId,
    name: "Public Audit Agency",
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
      id: pendingSiteId,
      organizationId,
      name: "Pending Prospect",
      canonicalUrl: `https://${primaryHostname}/`,
      status: "pending_verification",
    },
    {
      id: sameDomainSiteId,
      organizationId,
      name: "Same Domain Prospect",
      canonicalUrl: `https://${primaryHostname}/about`,
      status: "pending_verification",
    },
    {
      id: otherSiteId,
      organizationId,
      name: "Other Prospect",
      canonicalUrl: `https://${otherHostname}/`,
      status: "pending_verification",
    },
  ]);

  return {
    ownerId,
    memberId,
    outsiderId,
    organizationId,
    pendingSiteId,
    sameDomainSiteId,
    otherSiteId,
  };
}

async function cleanupFixture(organizationId: string, userIds: string[]) {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(inArray(users.id, userIds));
}

describeDatabase("public audit creation", () => {
  it("allows a pending site without DNS verification and persists the mode", async () => {
    const fixture = await createFixture();

    try {
      const scan = await createPublicAuditForSite(
        fixture.ownerId,
        fixture.organizationId,
        fixture.pendingSiteId,
        new Date("2026-09-22T12:00:00.000Z"),
        relaxedLimits,
      );

      const [persisted] = await db
        .select({
          status: scans.status,
          trigger: scans.trigger,
          scanMode: scans.scanMode,
          requestedByUserId: scans.requestedByUserId,
        })
        .from(scans)
        .where(eq(scans.id, scan.id))
        .limit(1);

      const [dispatch] = await db
        .select({ status: scanDispatches.status })
        .from(scanDispatches)
        .where(eq(scanDispatches.scanId, scan.id))
        .limit(1);

      expect(persisted).toEqual({
        status: "queued",
        trigger: "manual",
        scanMode: "public_audit",
        requestedByUserId: fixture.ownerId,
      });
      expect(dispatch?.status).toBe("pending");
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
        fixture.outsiderId,
      ]);
    }
  });

  it("allows an authenticated organization member", async () => {
    const fixture = await createFixture();

    try {
      const scan = await createPublicAuditForSite(
        fixture.memberId,
        fixture.organizationId,
        fixture.otherSiteId,
        new Date("2026-09-22T12:00:00.000Z"),
        relaxedLimits,
      );

      expect(scan.scanMode).toBe("public_audit");
      expect(scan.requestedByUserId).toBe(fixture.memberId);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
        fixture.outsiderId,
      ]);
    }
  });

  it("rejects a user outside the organization", async () => {
    const fixture = await createFixture();

    try {
      await expect(
        createPublicAuditForSite(
          fixture.outsiderId,
          fixture.organizationId,
          fixture.pendingSiteId,
          new Date("2026-09-22T12:00:00.000Z"),
          relaxedLimits,
        ),
      ).rejects.toBeInstanceOf(OrganizationAccessError);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
        fixture.outsiderId,
      ]);
    }
  });

  it("enforces the per-user concurrent audit limit", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-09-22T12:00:00.000Z");

    try {
      await db.insert(scans).values({
        organizationId: fixture.organizationId,
        siteId: fixture.otherSiteId,
        trigger: "manual",
        scanMode: "public_audit",
        requestedByUserId: fixture.ownerId,
        status: "queued",
        queuedAt: new Date(now.getTime() - 60_000),
      });

      await expect(
        createPublicAuditForSite(
          fixture.ownerId,
          fixture.organizationId,
          fixture.pendingSiteId,
          now,
          {
            userHourlyLimit: 100,
            userConcurrentLimit: 1,
            domainCooldownMs: 1,
          },
        ),
      ).rejects.toMatchObject({
        code: "user-concurrency-limit",
      } satisfies Partial<PublicAuditError>);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
        fixture.outsiderId,
      ]);
    }
  });

  it("enforces a cooldown across different site records for the same hostname", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-09-22T12:00:00.000Z");

    try {
      await db.insert(scans).values({
        organizationId: fixture.organizationId,
        siteId: fixture.pendingSiteId,
        trigger: "manual",
        scanMode: "public_audit",
        requestedByUserId: fixture.ownerId,
        status: "completed",
        queuedAt: new Date(now.getTime() - 60_000),
        completedAt: new Date(now.getTime() - 30_000),
      });

      await expect(
        createPublicAuditForSite(
          fixture.memberId,
          fixture.organizationId,
          fixture.sameDomainSiteId,
          now,
          {
            userHourlyLimit: 100,
            userConcurrentLimit: 10,
            domainCooldownMs: 10 * 60_000,
          },
        ),
      ).rejects.toMatchObject({
        code: "domain-cooldown",
      } satisfies Partial<PublicAuditError>);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
        fixture.outsiderId,
      ]);
    }
  });

  it("prevents concurrent public audits of the same hostname", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-09-22T12:00:00.000Z");

    try {
      await db.insert(scans).values({
        organizationId: fixture.organizationId,
        siteId: fixture.pendingSiteId,
        trigger: "manual",
        scanMode: "public_audit",
        requestedByUserId: fixture.ownerId,
        status: "running",
        queuedAt: new Date(now.getTime() - 60_000),
        startedAt: new Date(now.getTime() - 30_000),
      });

      await expect(
        createPublicAuditForSite(
          fixture.memberId,
          fixture.organizationId,
          fixture.sameDomainSiteId,
          now,
          {
            userHourlyLimit: 100,
            userConcurrentLimit: 10,
            domainCooldownMs: 1,
          },
        ),
      ).rejects.toMatchObject({
        code: "domain-busy",
      } satisfies Partial<PublicAuditError>);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
        fixture.outsiderId,
      ]);
    }
  });

  it("enforces the per-user hourly public audit quota", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-09-22T12:00:00.000Z");

    try {
      await db.insert(scans).values([
        {
          organizationId: fixture.organizationId,
          siteId: fixture.pendingSiteId,
          trigger: "manual",
          scanMode: "public_audit",
          requestedByUserId: fixture.ownerId,
          status: "completed",
          queuedAt: new Date(now.getTime() - 10 * 60_000),
          completedAt: new Date(now.getTime() - 9 * 60_000),
        },
        {
          organizationId: fixture.organizationId,
          siteId: fixture.otherSiteId,
          trigger: "manual",
          scanMode: "public_audit",
          requestedByUserId: fixture.ownerId,
          status: "completed",
          queuedAt: new Date(now.getTime() - 20 * 60_000),
          completedAt: new Date(now.getTime() - 19 * 60_000),
        },
      ]);

      await expect(
        createPublicAuditForSite(
          fixture.ownerId,
          fixture.organizationId,
          fixture.sameDomainSiteId,
          now,
          {
            userHourlyLimit: 2,
            userConcurrentLimit: 10,
            domainCooldownMs: 1,
          },
        ),
      ).rejects.toMatchObject({
        code: "user-hourly-limit",
      } satisfies Partial<PublicAuditError>);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.memberId,
        fixture.outsiderId,
      ]);
    }
  });
});
