import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
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
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { analyzeAndPersistDeepObservations } from "../src/scan-engine/deep-checks.js";
import { revalidateDeepAuditAuthorization } from "../src/scan-engine/deep-proof.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

afterAll(async () => {
  await closeDatabase();
});

describeDatabase("V3 schema compatibility", () => {
  it("revalidates DNS and persists check evidence and partial coverage once", async () => {
    const { db } = getDatabase();
    const organizationId = randomUUID();
    const siteId = randomUUID();
    const scanId = randomUUID();
    const now = new Date();
    const token = "agency-monitor-deep=integration-token";
    try {
      await db
        .insert(organizations)
        .values({ id: organizationId, name: "V3 engine test" });
      await db.insert(sites).values({
        id: siteId,
        organizationId,
        name: "Deep engine fixture",
        canonicalUrl: "https://deep.example.test/",
        status: "active",
        verifiedAt: now,
      });
      await db.insert(scans).values({
        id: scanId,
        organizationId,
        siteId,
        trigger: "manual",
        status: "running",
        scanMode: "verified_deep_audit",
      });
      await db.insert(deepAuditAuthorizations).values({
        siteId,
        proofType: "dns_txt",
        proofRecordName: "_agency-monitor.deep.example.test",
        proofTokenHash: createHash("sha256").update(token).digest("hex"),
        proofVerifiedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      });
      const authorization = await revalidateDeepAuditAuthorization({
        siteId,
        organizationId,
        now,
        resolveTxt: async () => [[token]],
      });
      expect(authorization).toEqual({ allowed: true, level: "deep" });
      const profile = {
        ...resolveScanProfile("verified_deep_audit"),
        allowedChecks: ["deep-http-observation", "deep-browser-observation"],
      };
      const ledger = new BudgetLedger(profile.budget, now.getTime());
      const input = {
        scanId,
        organizationId,
        siteId,
        targetUrl: "https://deep.example.test/",
        profile,
        authorization,
        scope: new ScopeGuard("https://deep.example.test/"),
        ledger,
        observations: {
          http: {
            ok: true as const,
            finalUrl: "https://deep.example.test/",
            statusCode: 200,
            durationMs: 1,
            redirects: [],
            headers: {},
            securityHeaders: [],
            tls: null,
          },
          browser: {
            finalUrl: "https://deep.example.test/",
            statusCode: 200,
            pageCount: 1,
            durationMs: 1,
          },
        },
      };
      const runs = await analyzeAndPersistDeepObservations(input);
      expect(runs).toHaveLength(2);
      const persisted = await db
        .select()
        .from(scanCheckRuns)
        .where(eq(scanCheckRuns.scanId, scanId));
      expect(persisted).toHaveLength(2);
      expect(persisted.every((run) => run.evidence.length === 1)).toBe(true);
      const [scan] = await db
        .select({ summary: scans.summary })
        .from(scans)
        .where(eq(scans.id, scanId));
      expect(scan?.summary.v3Coverage).toMatchObject({
        totalChecks: 2,
        completedChecks: 2,
        partial: false,
      });
      await expect(analyzeAndPersistDeepObservations(input)).rejects.toThrow(
        "already persisted",
      );
      const denied = await revalidateDeepAuditAuthorization({
        siteId,
        organizationId,
        now: new Date(now.getTime() + 1_000),
        resolveTxt: async () => [["wrong"]],
      });
      expect(denied).toMatchObject({ allowed: false });
      const [grant] = await db
        .select({ revalidatedAt: deepAuditAuthorizations.revalidatedAt })
        .from(deepAuditAuthorizations)
        .where(eq(deepAuditAuthorizations.siteId, siteId));
      expect(grant?.revalidatedAt).toBeNull();
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  });
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
