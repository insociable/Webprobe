import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  deepAuditAuthorizations,
  organizations,
  scanCheckRuns,
  scans,
  sites,
} from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import { validateScanContext } from "../src/scan-persistence.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

afterAll(async () => {
  await closeDatabase();
});

describeDatabase("V3 schema compatibility", () => {
  it("preserves old scan defaults and stores deep audit metadata without enabling network execution", async () => {
    const { db } = getDatabase();
    const organizationId = randomUUID();
    const legacySiteId = randomUUID();
    const deepSiteId = randomUUID();
    const legacyScanId = randomUUID();
    const deepScanId = randomUUID();
    const now = new Date();

    try {
      await db
        .insert(organizations)
        .values({ id: organizationId, name: "V3 schema test" });
      await db.insert(sites).values([
        {
          id: legacySiteId,
          organizationId,
          name: "Legacy monitoring",
          canonicalUrl: "https://legacy.example.test/",
          status: "active",
          verifiedAt: now,
        },
        {
          id: deepSiteId,
          organizationId,
          name: "Deep audit",
          canonicalUrl: "https://deep.example.test/",
          status: "active",
          verifiedAt: now,
        },
      ]);
      await db.insert(scans).values({
        id: legacyScanId,
        organizationId,
        siteId: legacySiteId,
        trigger: "manual",
        status: "completed",
      });
      await db.insert(scans).values({
        id: deepScanId,
        organizationId,
        siteId: deepSiteId,
        trigger: "manual",
        scanMode: "verified_deep_audit",
      });
      await db.insert(deepAuditAuthorizations).values({
        siteId: deepSiteId,
        proofType: "dns_txt",
        proofVerifiedAt: now,
        revalidatedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      });
      await db.insert(scanCheckRuns).values({
        scanId: deepScanId,
        checkId: "test-observation",
        checkVersion: "1.0.0",
        status: "skipped",
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        budgetUsed: {},
        skipReason: "engine-not-enabled",
      });

      const [legacy] = await db
        .select({ mode: scans.scanMode })
        .from(scans)
        .where(eq(scans.id, legacyScanId));
      expect(legacy?.mode).toBe("verified_monitoring");
      const [deep] = await db
        .select({ mode: scans.scanMode })
        .from(scans)
        .where(eq(scans.id, deepScanId));
      expect(deep?.mode).toBe("verified_deep_audit");
      await expect(
        validateScanContext({
          scanId: deepScanId,
          organizationId,
          siteId: deepSiteId,
          targetUrl: "https://deep.example.test/",
          profile: {
            maxPages: 100,
            navigationTimeoutMs: 60_000,
            checkAccessibility: true,
            captureScreenshots: true,
          },
        }),
      ).rejects.toMatchObject({ code: "deep-engine-unavailable" });
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  });
});
