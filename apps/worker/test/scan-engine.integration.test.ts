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
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { closeDatabase, getDatabase } from "../src/database.js";
import { validateScanContext } from "../src/scan-persistence.js";
import { runDeepAuditCandidate } from "../src/scan-engine/deep-candidate.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";

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
        generationId: randomUUID(),
        proofVerifiedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      });
      const profile = {
        ...resolveScanProfile("verified_deep_audit"),
        allowedChecks: ["deep-http-observation", "deep-browser-observation"],
      };
      let requests = 0;
      let onPage: ((page: Page) => void) | undefined;
      const fakePage = {
        on: () => fakePage,
        goto: async () => ({ status: () => 200 }) as unknown as Response,
        url: () => "https://deep.example.test/",
        close: async () => undefined,
      } as unknown as Page;
      const fakeContext = {
        setDefaultNavigationTimeout: () => undefined,
        setDefaultTimeout: () => undefined,
        on: (event: string, handler: (page: Page) => void) => {
          if (event === "page") onPage = handler;
          return fakeContext;
        },
        route: async () => undefined,
        routeWebSocket: async () => undefined,
        newPage: async () => {
          onPage?.(fakePage);
          return fakePage;
        },
        close: async () => undefined,
      } as unknown as BrowserContext;
      const fakeBrowser = {
        newContext: async () => fakeContext,
        close: async () => undefined,
      } as unknown as Browser;
      const input = {
        scanId,
        organizationId,
        siteId,
        targetUrl: "https://deep.example.test/",
        profile,
        resolveTxt: async () => [[token]],
        resolver: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
        requester: async (
          _target: unknown,
          _timeout: number,
          account?: (bytes: number) => void,
        ) => {
          requests += 1;
          account?.(256);
          return { statusCode: 200, durationMs: 1, tls: null, headers: {} };
        },
        launchBrowser: async () => fakeBrowser,
      };
      await runDeepAuditCandidate(input);
      const persisted = await db
        .select()
        .from(scanCheckRuns)
        .where(eq(scanCheckRuns.scanId, scanId));
      expect(persisted).toHaveLength(10);
      expect(
        persisted.filter((run) => run.status === "completed"),
      ).toHaveLength(2);
      expect(
        persisted
          .filter((run) => run.status === "completed")
          .every((run) => run.evidence.length === 1),
      ).toBe(true);
      const [scan] = await db
        .select({ summary: scans.summary })
        .from(scans)
        .where(eq(scans.id, scanId));
      expect(scan?.summary.v3Coverage).toMatchObject({
        totalChecks: 10,
        completedChecks: 2,
        partial: false,
      });
      await expect(runDeepAuditCandidate(input)).rejects.toThrow("not running");
      expect(requests).toBe(1);
      await db
        .update(scans)
        .set({ status: "completed" })
        .where(eq(scans.id, scanId));
      const deniedScanId = randomUUID();
      await db.insert(scans).values({
        id: deniedScanId,
        organizationId,
        siteId,
        trigger: "manual",
        status: "running",
        scanMode: "verified_deep_audit",
      });
      await expect(
        runDeepAuditCandidate({
          ...input,
          scanId: deniedScanId,
          resolveTxt: async () => [["wrong"]],
        }),
      ).rejects.toMatchObject({ code: "deep-authorization-denied" });
      const deniedRuns = await db
        .select()
        .from(scanCheckRuns)
        .where(eq(scanCheckRuns.scanId, deniedScanId));
      expect(deniedRuns).toHaveLength(10);
      expect(
        deniedRuns.every(
          (run) =>
            run.status === "skipped" &&
            run.skipReason === "authorization-unavailable",
        ),
      ).toBe(true);
      expect(requests).toBe(1);
      const [deniedScan] = await db
        .select({ status: scans.status, summary: scans.summary })
        .from(scans)
        .where(eq(scans.id, deniedScanId));
      expect(deniedScan?.status).toBe("failed");
      expect(deniedScan?.summary).toMatchObject({
        deepError: {
          code: "deep-authorization-denied",
          reason: "deep-grant-invalid",
        },
      });
      const [grant] = await db
        .select({ revalidatedAt: deepAuditAuthorizations.revalidatedAt })
        .from(deepAuditAuthorizations)
        .where(eq(deepAuditAuthorizations.siteId, siteId));
      expect(grant?.revalidatedAt).toBeNull();
      const limitedScanId = randomUUID();
      await db.insert(scans).values({
        id: limitedScanId,
        organizationId,
        siteId,
        trigger: "manual",
        status: "running",
        scanMode: "verified_deep_audit",
      });
      await runDeepAuditCandidate({
        ...input,
        scanId: limitedScanId,
        profile: {
          ...profile,
          budget: { ...profile.budget, bytesTransferred: 128 },
        },
      });
      const limitedRuns = await db
        .select()
        .from(scanCheckRuns)
        .where(eq(scanCheckRuns.scanId, limitedScanId));
      expect(limitedRuns).toHaveLength(10);
      expect(
        limitedRuns
          .filter((run) => profile.allowedChecks.includes(run.checkId))
          .every((run) => run.skipReason === "budget-bytes-transferred"),
      ).toBe(true);
      const [limitedScan] = await db
        .select({ summary: scans.summary })
        .from(scans)
        .where(eq(scans.id, limitedScanId));
      expect(limitedScan?.summary.v3Coverage).toMatchObject({ partial: true });
      expect(requests).toBe(2);
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  });
  it("runs Deep from the existing verified-site proof without a second grant", async () => {
    const { db } = getDatabase();
    const organizationId = randomUUID();
    const siteId = randomUUID();
    const scanId = randomUUID();

    try {
      await db.insert(organizations).values({
        id: organizationId,
        name: "Verified-site Deep test",
      });
      await db.insert(sites).values({
        id: siteId,
        organizationId,
        name: "Verified Deep target",
        canonicalUrl: "https://verified-deep.example.test/",
        status: "active",
        verifiedAt: new Date(),
      });
      await db.insert(scans).values({
        id: scanId,
        organizationId,
        siteId,
        trigger: "manual",
        status: "running",
        scanMode: "verified_deep_audit",
      });

      let requests = 0;
      await runDeepAuditCandidate({
        scanId,
        organizationId,
        siteId,
        targetUrl: "https://verified-deep.example.test/",
        profile: {
          ...resolveScanProfile("verified_deep_audit"),
          allowedChecks: ["deep-http-observation"],
        },
        resolver: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
        requester: async (_target, _timeout, account) => {
          requests += 1;
          account?.(128);
          return {
            statusCode: 200,
            durationMs: 1,
            tls: null,
            headers: {},
          };
        },
      });

      expect(requests).toBe(1);
      const runs = await db
        .select()
        .from(scanCheckRuns)
        .where(eq(scanCheckRuns.scanId, scanId));
      expect(runs).toHaveLength(10);
      expect(runs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            checkId: "deep-http-observation",
            status: "completed",
          }),
          expect.objectContaining({
            checkId: "deep-browser-observation",
            status: "skipped",
          }),
        ]),
      );

      const grants = await db
        .select()
        .from(deepAuditAuthorizations)
        .where(eq(deepAuditAuthorizations.siteId, siteId));
      expect(grants).toHaveLength(0);

      const [persisted] = await db
        .select({ status: scans.status, summary: scans.summary })
        .from(scans)
        .where(eq(scans.id, scanId));
      expect(persisted?.status).toBe("completed");
      expect(persisted?.summary.v3Coverage).toMatchObject({
        totalChecks: 10,
        completedChecks: 1,
        skippedChecks: 9,
      });
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
        generationId: randomUUID(),
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
