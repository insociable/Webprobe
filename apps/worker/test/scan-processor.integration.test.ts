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

async function createFixture(
  scanMode: "public_audit" | "verified_monitoring" = "verified_monitoring",
) {
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
    status: scanMode === "public_audit" ? "pending_verification" : "active",
    verifiedAt: scanMode === "public_audit" ? null : new Date(),
  });
  await db.insert(scans).values({
    id: scanId,
    organizationId,
    siteId,
    trigger: "manual",
    scanMode,
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
  it("derives the browser policy from the persisted public audit mode", async () => {
    const fixture = await createFixture("public_audit");
    let receivedMode: string | undefined;

    try {
      const result = await processScanJob(fixture.payload, {
        probeHttpTarget: async () => successfulProbe(),
        runBrowserScan: async (_url, options) => {
          receivedMode = options.scanMode;
          return {
            pagesVisited: 1,
            screenshot: null,
            observations: [],
          };
        },
      });

      expect(result.status).toBe("completed");
      expect(receivedMode).toBe("public_audit");
    } finally {
      await cleanup(fixture.organizationId);
    }
  });

  it("persists browser findings and browser page count atomically", async () => {
    const fixture = await createFixture();

    try {
      const result = await processScanJob(fixture.payload, {
        probeHttpTarget: async () => successfulProbe(),
        runBrowserScan: async () => ({
          pagesVisited: 3,
          screenshot: null,
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
          scannerV2: {
            crawl: {
              maxPages: 3,
              discoveredUrlCount: 3,
              visitedUrlCount: 3,
              ignoredUrlCount: 0,
              unvisitedUrlCount: 0,
              budgetReached: false,
              urls: [],
              redirects: [],
              malformedUrlCount: 0,
            },
            network: {
              resources: [],
              failedRequests: [],
              consoleErrors: [],
              javascriptErrors: [],
              issues: [],
              suppressedThirdPartyIssueCount: 0,
              collection: {
                maxRetainedObservationCount: 400,
                retainedObservationCount: 0,
                droppedObservationCount: 0,
                truncated: false,
              },
            },
            performance: [],
            seo: {
              pages: [],
              signals: [
                {
                  code: "seo.title.missing",
                  level: "warning",
                  pageUrl: "https://example.com/about",
                  evidence: {},
                },
              ],
            },
            completeness: {
              crawl: { status: "complete", linkExtractionFailureCount: 0 },
              network: { status: "complete", captureFailureCount: 0 },
              performance: {
                status: "unavailable",
                eligiblePageCount: 0,
                observedPageCount: 0,
                observerInstalled: true,
              },
              seo: {
                status: "complete",
                eligiblePageCount: 3,
                observedPageCount: 3,
              },
            },
          },
        }),
      });

      expect(result.status).toBe("completed");
      expect(result.pagesVisited).toBe(3);
      expect(result.findings.map((item) => item.code).sort()).toEqual([
        "accessibility.color-contrast",
        "broken-link.http-error",
        "javascript.uncaught-error",
        "seo.title.missing",
      ]);
      expect(result.scannerV2?.completeness.seo.status).toBe("complete");

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
        summary: expect.objectContaining({
          findingCount: 4,
          scannerV2: expect.objectContaining({
            version: 1,
            completeness: expect.objectContaining({
              seo: expect.objectContaining({ status: "complete" }),
            }),
          }),
        }),
      });
      expect(persistedFindings).toHaveLength(4);
      expect(JSON.stringify(persistedFindings)).not.toContain(
        "secret navigation",
      );
    } finally {
      await cleanup(fixture.organizationId);
    }
  });

  it("stores a captured screenshot without changing scan completion semantics", async () => {
    const fixture = await createFixture();
    fixture.payload.profile.captureScreenshots = true;
    let persisted = false;

    try {
      const result = await processScanJob(fixture.payload, {
        probeHttpTarget: async () => successfulProbe(),
        runBrowserScan: async () => ({
          pagesVisited: 1,
          observations: [],
          screenshot: {
            data: Buffer.from("jpeg-bytes"),
            mediaType: "image/jpeg",
          },
        }),
        persistPrimaryScreenshot: async (input) => {
          persisted =
            input.scanId === fixture.scanId &&
            input.screenshot.data.equals(Buffer.from("jpeg-bytes"));
          return true;
        },
      });

      expect(result.status).toBe("completed");
      expect(result.screenshotStored).toBe(true);
      expect(persisted).toBe(true);
    } finally {
      await cleanup(fixture.organizationId);
    }
  });

  it("keeps a completed scan when screenshot persistence fails", async () => {
    const fixture = await createFixture();
    fixture.payload.profile.captureScreenshots = true;

    try {
      const result = await processScanJob(fixture.payload, {
        probeHttpTarget: async () => successfulProbe(),
        runBrowserScan: async () => ({
          pagesVisited: 1,
          observations: [],
          screenshot: {
            data: Buffer.from("jpeg-bytes"),
            mediaType: "image/jpeg",
          },
        }),
        persistPrimaryScreenshot: async () => {
          throw new Error("artifact store unavailable");
        },
      });

      expect(result.status).toBe("completed");
      expect(result.screenshotStored).toBe(false);

      const { db } = getDatabase();
      const [persistedScan] = await db
        .select({ status: scans.status })
        .from(scans)
        .where(eq(scans.id, fixture.scanId));
      expect(persistedScan?.status).toBe("completed");
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
