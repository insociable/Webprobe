import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { findings, organizations, scans, sites } from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import type { HttpProbeResult } from "../src/http-probe.js";
import { processScanJob } from "../src/scan-processor.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

afterAll(async () => {
  await closeDatabase();
});

function successfulProbe(
  contentType = "text/html; charset=utf-8",
): Extract<HttpProbeResult, { ok: true }> {
  return {
    ok: true,
    finalUrl: "https://example.com/",
    statusCode: 200,
    durationMs: 100,
    redirects: [],
    headers: { "content-type": contentType },
    securityHeaders: [],
    tls: null,
  };
}

async function createFixture() {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const scanId = randomUUID();

  await db.insert(organizations).values({
    id: organizationId,
    name: "Browser processor integration",
  });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Browser processor target",
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
        maxPages: 3,
        navigationTimeoutMs: 5_000,
        checkAccessibility: true,
        captureScreenshots: false,
      },
    },
  };
}

async function cleanup(organizationId: string) {
  const { db } = getDatabase();
  await db.delete(organizations).where(eq(organizations.id, organizationId));
}

describeDatabase("scan processor browser findings", () => {
  it("persists browser findings and browser page count atomically", async () => {
    const fixture = await createFixture();

    try {
      const result = await processScanJob(fixture.payload, {
        probeHttpTarget: async () => successfulProbe(),
        runBrowserScan: async () => ({
          pagesVisited: 3,
          observations: [
            {
              url: "https://example.com/",
              sourcePageUrl: null,
              statusCode: 200,
              navigationFailed: false,
              javascriptErrorCount: 2,
              accessibilityViolations: [
                {
                  ruleId: "color-contrast",
                  impact: "serious",
                  nodeCount: 3,
                },
              ],
            },
            {
              url: "https://example.com/missing",
              sourcePageUrl: "https://example.com/",
              statusCode: 404,
              navigationFailed: false,
              javascriptErrorCount: 0,
              accessibilityViolations: [],
            },
            {
              url: "https://example.com/about",
              sourcePageUrl: "https://example.com/",
              statusCode: 200,
              navigationFailed: false,
              javascriptErrorCount: 0,
              accessibilityViolations: [],
            },
          ],
        }),
      });

      expect(result.status).toBe("completed");
      expect(result.pagesVisited).toBe(3);
      expect(result.findings.map((item) => item.code).sort()).toEqual([
        "accessibility.color-contrast",
        "broken-link.http-error",
        "javascript.uncaught-error",
      ]);

      const { db } = getDatabase();
      const [persistedScan] = await db
        .select({
          status: scans.status,
          pageCount: scans.pageCount,
          summary: scans.summary,
        })
        .from(scans)
        .where(eq(scans.id, fixture.scanId));

      const persistedFindings = await db
        .select({
          category: findings.category,
          code: findings.code,
          evidence: findings.evidence,
        })
        .from(findings)
        .where(
          and(
            eq(findings.organizationId, fixture.organizationId),
            eq(findings.scanId, fixture.scanId),
          ),
        );

      expect(persistedScan).toMatchObject({
        status: "completed",
        pageCount: 3,
        summary: expect.objectContaining({ findingCount: 3 }),
      });
      expect(persistedFindings).toHaveLength(3);
      expect(JSON.stringify(persistedFindings)).not.toContain(
        "secret navigation",
      );
    } finally {
      await cleanup(fixture.organizationId);
    }
  });

  it("does not start Chromium for a non-HTML response", async () => {
    const fixture = await createFixture();
    let browserStarted = false;

    try {
      const result = await processScanJob(fixture.payload, {
        probeHttpTarget: async () => successfulProbe("application/pdf"),
        runBrowserScan: async () => {
          browserStarted = true;
          throw new Error("must not run");
        },
      });

      expect(browserStarted).toBe(false);
      expect(result.status).toBe("completed");
      expect(result.pagesVisited).toBe(1);
    } finally {
      await cleanup(fixture.organizationId);
    }
  });

  it("fails the scan instead of silently skipping a browser runtime failure", async () => {
    const fixture = await createFixture();

    try {
      await expect(
        processScanJob(fixture.payload, {
          probeHttpTarget: async () => successfulProbe(),
          runBrowserScan: async () => {
            throw new Error("browser execution failed");
          },
        }),
      ).rejects.toThrow("browser execution failed");

      const { db } = getDatabase();
      const [persistedScan] = await db
        .select({
          status: scans.status,
          summary: scans.summary,
        })
        .from(scans)
        .where(eq(scans.id, fixture.scanId));

      expect(persistedScan?.status).toBe("failed");
      expect(JSON.stringify(persistedScan?.summary)).not.toContain(
        "browser execution failed",
      );

      const persistedFindings = await db
        .select({ id: findings.id })
        .from(findings)
        .where(eq(findings.scanId, fixture.scanId));
      expect(persistedFindings).toHaveLength(0);
    } finally {
      await cleanup(fixture.organizationId);
    }
  });
});
