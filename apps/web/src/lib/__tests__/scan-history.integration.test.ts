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
import { eq } from "drizzle-orm";
import { db } from "../database";
import { getScanDetailsForSite, getSiteScanHistory } from "../scan-history";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

async function createFixture() {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const siteIds = [randomUUID(), randomUUID()];
  const scanIds = [randomUUID(), randomUUID()];

  await db.insert(users).values({
    id: userId,
    email: `history-${userId}@example.invalid`,
    displayName: "History User",
  });

  await db.insert(organizations).values({
    id: organizationId,
    name: "History Agency",
  });

  await db.insert(memberships).values({
    organizationId,
    userId,
    role: "owner",
  });

  await db.insert(sites).values([
    {
      id: siteIds[0],
      organizationId,
      name: "History Site A",
      canonicalUrl: "https://example.com/",
      status: "active",
      verifiedAt: new Date(),
    },
    {
      id: siteIds[1],
      organizationId,
      name: "History Site B",
      canonicalUrl: "https://example.org/",
      status: "active",
      verifiedAt: new Date(),
    },
  ]);

  await db.insert(scans).values([
    {
      id: scanIds[0],
      organizationId,
      siteId: siteIds[0],
      status: "completed",
      trigger: "manual",
      pageCount: 1,
      queuedAt: new Date("2026-09-22T05:00:00Z"),
      completedAt: new Date("2026-09-22T05:00:02Z"),
      summary: { findingCount: 1 },
    },
    {
      id: scanIds[1],
      organizationId,
      siteId: siteIds[1],
      status: "completed",
      trigger: "manual",
      pageCount: 1,
      queuedAt: new Date("2026-09-22T06:00:00Z"),
      completedAt: new Date("2026-09-22T06:00:02Z"),
      summary: { findingCount: 0 },
    },
  ]);

  await db.insert(findings).values({
    organizationId,
    scanId: scanIds[0],
    category: "security-header",
    severity: "medium",
    code: "security-header.csp.missing",
    title: "Content-Security-Policy absent",
    pageUrl: "https://example.com/",
    fingerprint: "b".repeat(64),
    evidence: { header: "content-security-policy" },
  });

  return { userId, organizationId, siteIds, scanIds };
}

async function cleanupFixture(organizationId: string, userId: string) {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(eq(users.id, userId));
}

describeDatabase("scan history tenant scoping", () => {
  it("lists only scans belonging to the requested site", async () => {
    const fixture = await createFixture();

    try {
      const history = await getSiteScanHistory(
        fixture.userId,
        fixture.organizationId,
        fixture.siteIds[0]!,
      );

      expect(history?.site.id).toBe(fixture.siteIds[0]);
      expect(history?.scans.map((scan) => scan.id)).toEqual([
        fixture.scanIds[0],
      ]);
    } finally {
      await cleanupFixture(fixture.organizationId, fixture.userId);
    }
  });

  it("returns findings only for a scan bound to the requested site", async () => {
    const fixture = await createFixture();

    try {
      const details = await getScanDetailsForSite(
        fixture.userId,
        fixture.organizationId,
        fixture.siteIds[0]!,
        fixture.scanIds[0]!,
      );

      expect(details?.scan.id).toBe(fixture.scanIds[0]);
      expect(details?.findings).toEqual([
        expect.objectContaining({
          code: "security-header.csp.missing",
          severity: "medium",
        }),
      ]);

      await expect(
        getScanDetailsForSite(
          fixture.userId,
          fixture.organizationId,
          fixture.siteIds[0]!,
          fixture.scanIds[1]!,
        ),
      ).resolves.toBeNull();
    } finally {
      await cleanupFixture(fixture.organizationId, fixture.userId);
    }
  });
});
