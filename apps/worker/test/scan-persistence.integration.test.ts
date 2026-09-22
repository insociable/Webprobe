import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { ScanResult } from "@agency-saas/contracts";
import { findings, organizations, scans, sites } from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import type { GeneratedFinding } from "../src/findings.js";
import type { HttpProbeResult } from "../src/http-probe.js";
import {
  markScanRunning,
  persistScanCompletion,
  ScanContextError,
  validateScanContext,
} from "../src/scan-persistence.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

afterAll(async () => {
  await closeDatabase();
});

function successfulProbe(): Extract<HttpProbeResult, { ok: true }> {
  return {
    ok: true,
    finalUrl: "https://example.com/",
    statusCode: 200,
    durationMs: 100,
    redirects: [],
    headers: { "content-type": "text/html" },
    securityHeaders: [],
    tls: {
      protocol: "TLSv1.3",
      cipher: "TLS_AES_256_GCM_SHA384",
      validFrom: "Sep 01 00:00:00 2026 GMT",
      validTo: "Dec 31 00:00:00 2026 GMT",
    },
  };
}

async function createFixture() {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const scanId = randomUUID();

  await db.insert(organizations).values({
    id: organizationId,
    name: "Worker persistence test",
  });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Persistence target",
    canonicalUrl: "https://example.com/",
    status: "active",
    verifiedAt: new Date(),
  });
  await db.insert(scans).values({
    id: scanId,
    organizationId,
    siteId,
    trigger: "manual",
  });

  return {
    organizationId,
    siteId,
    scanId,
    payload: {
      organizationId,
      siteId,
      scanId,
      targetUrl: "https://example.com/",
      profile: {
        maxPages: 20,
        navigationTimeoutMs: 20_000,
        checkAccessibility: true,
        captureScreenshots: true,
      },
    },
  };
}

async function deleteFixture(organizationId: string) {
  const { db } = getDatabase();
  await db.delete(organizations).where(eq(organizations.id, organizationId));
}

function completedResult(scanId: string, startedAt: Date): ScanResult {
  return {
    scanId,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    status: "completed",
    pagesVisited: 1,
    findings: [
      {
        category: "security-header",
        severity: "medium",
        code: "security-header.csp.missing",
        title: "Content-Security-Policy absent",
        pageUrl: "https://example.com/",
        evidence: { header: "content-security-policy" },
      },
    ],
  };
}

const generatedFinding: GeneratedFinding = {
  category: "security-header",
  severity: "medium",
  code: "security-header.csp.missing",
  title: "Content-Security-Policy absent",
  pageUrl: "https://example.com/",
  fingerprint: "a".repeat(64),
  evidence: { header: "content-security-policy" },
};

describeDatabase("scan persistence", () => {
  it("persists completion and findings for the validated tenant context", async () => {
    const { db } = getDatabase();
    const fixture = await createFixture();

    try {
      const context = await validateScanContext(fixture.payload);
      await markScanRunning(context);
      await persistScanCompletion(
        context,
        completedResult(fixture.scanId, context.startedAt),
        successfulProbe(),
        [generatedFinding],
      );
      const persistedScan = await db
        .select({
          status: scans.status,
          pageCount: scans.pageCount,
          summary: scans.summary,
        })
        .from(scans)
        .where(eq(scans.id, fixture.scanId))
        .limit(1);

      const persistedFindings = await db
        .select({
          code: findings.code,
          fingerprint: findings.fingerprint,
        })
        .from(findings)
        .where(
          and(
            eq(findings.scanId, fixture.scanId),
            eq(findings.organizationId, fixture.organizationId),
          ),
        );

      expect(persistedScan[0]).toMatchObject({
        status: "completed",
        pageCount: 1,
      });
      expect(persistedScan[0]?.summary).toMatchObject({
        findingCount: 1,
        targetUrl: "https://example.com/",
      });
      expect(persistedFindings).toEqual([
        {
          code: "security-header.csp.missing",
          fingerprint: "a".repeat(64),
        },
      ]);
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("does not overwrite a concurrent cancellation", async () => {
    const { db } = getDatabase();
    const fixture = await createFixture();

    try {
      const context = await validateScanContext(fixture.payload);
      await markScanRunning(context);

      await db
        .update(scans)
        .set({ status: "cancelled" })
        .where(eq(scans.id, fixture.scanId));

      await expect(
        persistScanCompletion(
          context,
          completedResult(fixture.scanId, context.startedAt),
          successfulProbe(),
          [generatedFinding],
        ),
      ).rejects.toBeInstanceOf(ScanContextError);

      const persistedScan = await db
        .select({ status: scans.status })
        .from(scans)
        .where(eq(scans.id, fixture.scanId))
        .limit(1);
      const persistedFindings = await db
        .select({ id: findings.id })
        .from(findings)
        .where(eq(findings.scanId, fixture.scanId));

      expect(persistedScan[0]?.status).toBe("cancelled");
      expect(persistedFindings).toHaveLength(0);
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });

  it("rejects a queued target that differs from the persisted site", async () => {
    const fixture = await createFixture();

    try {
      await expect(
        validateScanContext({
          ...fixture.payload,
          targetUrl: "https://example.org/",
        }),
      ).rejects.toMatchObject({ code: "target-mismatch" });
    } finally {
      await deleteFixture(fixture.organizationId);
    }
  });
});
