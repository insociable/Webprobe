import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  findings,
  memberships,
  organizations,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { inArray } from "drizzle-orm";
import { db } from "../database";
import { getOrganizationOverview } from "../organization-overview";
import { OrganizationAccessError } from "../organization-site-service";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("organization overview", () => {
  it("returns only tenant sites with the latest scan severity summary", async () => {
    const userIds = [randomUUID(), randomUUID()];
    const organizationIds = [randomUUID(), randomUUID()];
    const siteIds = [randomUUID(), randomUUID(), randomUUID()];
    const scanIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    try {
      await db.insert(users).values([
        {
          id: userIds[0],
          email: `overview-a-${userIds[0]}@example.invalid`,
          displayName: "Overview A",
        },
        {
          id: userIds[1],
          email: `overview-b-${userIds[1]}@example.invalid`,
          displayName: "Overview B",
        },
      ]);

      await db.insert(organizations).values([
        { id: organizationIds[0], name: "Overview Agency A" },
        { id: organizationIds[1], name: "Overview Agency B" },
      ]);

      await db.insert(memberships).values([
        {
          organizationId: organizationIds[0],
          userId: userIds[0],
          role: "owner",
        },
        {
          organizationId: organizationIds[1],
          userId: userIds[1],
          role: "owner",
        },
      ]);

      await db.insert(sites).values([
        {
          id: siteIds[0],
          organizationId: organizationIds[0],
          name: "Site A1",
          canonicalUrl: "https://example.com/",
          status: "active",
          verifiedAt: new Date(),
        },
        {
          id: siteIds[1],
          organizationId: organizationIds[0],
          name: "Site A2",
          canonicalUrl: "https://example.org/",
          status: "active",
          verifiedAt: new Date(),
        },
        {
          id: siteIds[2],
          organizationId: organizationIds[1],
          name: "Site B1",
          canonicalUrl: "https://example.net/",
          status: "active",
          verifiedAt: new Date(),
        },
      ]);

      await db.insert(scans).values([
        {
          id: scanIds[0],
          organizationId: organizationIds[0],
          siteId: siteIds[0],
          status: "completed",
          trigger: "manual",
          queuedAt: new Date("2026-09-22T05:00:00Z"),
          completedAt: new Date("2026-09-22T05:00:02Z"),
          summary: { findingCount: 1 },
        },
        {
          id: scanIds[1],
          organizationId: organizationIds[0],
          siteId: siteIds[0],
          status: "completed",
          trigger: "manual",
          queuedAt: new Date("2026-09-22T06:00:00Z"),
          completedAt: new Date("2026-09-22T06:00:02Z"),
          summary: { findingCount: 3 },
        },
        {
          id: scanIds[2],
          organizationId: organizationIds[0],
          siteId: siteIds[1],
          status: "running",
          trigger: "manual",
          queuedAt: new Date("2026-09-22T07:00:00Z"),
          startedAt: new Date("2026-09-22T07:00:01Z"),
        },
        {
          id: scanIds[3],
          organizationId: organizationIds[1],
          siteId: siteIds[2],
          status: "completed",
          trigger: "manual",
          queuedAt: new Date("2026-09-22T08:00:00Z"),
          completedAt: new Date("2026-09-22T08:00:02Z"),
          summary: { findingCount: 1 },
        },
      ]);

      await db.insert(findings).values([
        {
          organizationId: organizationIds[0],
          scanId: scanIds[0],
          category: "legacy",
          severity: "critical",
          code: "old-critical",
          title: "Old critical",
          fingerprint: "a".repeat(64),
        },
        {
          organizationId: organizationIds[0],
          scanId: scanIds[1],
          category: "security",
          severity: "critical",
          code: "latest-critical",
          title: "Latest critical",
          fingerprint: "b".repeat(64),
        },
        {
          organizationId: organizationIds[0],
          scanId: scanIds[1],
          category: "security",
          severity: "high",
          code: "latest-high",
          title: "Latest high",
          fingerprint: "c".repeat(64),
        },
        {
          organizationId: organizationIds[0],
          scanId: scanIds[1],
          category: "security",
          severity: "medium",
          code: "latest-medium",
          title: "Latest medium",
          fingerprint: "d".repeat(64),
        },
        {
          organizationId: organizationIds[1],
          scanId: scanIds[3],
          category: "security",
          severity: "critical",
          code: "other-tenant-critical",
          title: "Other tenant critical",
          fingerprint: "e".repeat(64),
        },
      ]);

      const overview = await getOrganizationOverview(
        userIds[0]!,
        organizationIds[0]!,
      );
      expect(overview.sites.map((site) => site.id).sort()).toEqual(
        [siteIds[0], siteIds[1]].sort(),
      );

      const siteA1 = overview.sites.find((site) => site.id === siteIds[0]);
      const siteA2 = overview.sites.find((site) => site.id === siteIds[1]);

      expect(siteA1?.latestScan).toMatchObject({
        id: scanIds[1],
        findingCount: 3,
        criticalCount: 1,
        highCount: 1,
      });
      expect(siteA2?.latestScan).toMatchObject({
        id: scanIds[2],
        status: "running",
        criticalCount: 0,
        highCount: 0,
      });

      await expect(
        getOrganizationOverview(userIds[0]!, organizationIds[1]!),
      ).rejects.toBeInstanceOf(OrganizationAccessError);
    } finally {
      await db.delete(users).where(inArray(users.id, userIds));
      await db
        .delete(organizations)
        .where(inArray(organizations.id, organizationIds));
    }
  });
});
