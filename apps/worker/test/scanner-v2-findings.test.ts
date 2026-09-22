import { describe, expect, it } from "vitest";
import {
  generateScannerV2Findings,
  summarizeScannerV2,
  type ScannerV2Data,
} from "../src/scanner-v2/findings.js";

function scannerV2Fixture(): ScannerV2Data {
  return {
    crawl: {
      maxPages: 20,
      discoveredUrlCount: 4,
      visitedUrlCount: 3,
      ignoredUrlCount: 0,
      unvisitedUrlCount: 1,
      budgetReached: true,
      malformedUrlCount: 1,
      urls: [],
      redirects: [
        {
          fromUrl: "https://example.com/old",
          toUrl: "https://example.com/new",
          statusCode: 301,
        },
      ],
    },
    network: {
      resources: [],
      failedRequests: [],
      consoleErrors: [],
      javascriptErrors: [],
      issues: [
        {
          key: "resource-500",
          kind: "http-5xx",
          party: "first-party",
          resourceType: "script",
          resourceUrl: "https://example.com/app.js",
          resourceKey: "https://example.com/app.js",
          statusCode: 503,
          failureClass: null,
          errorClass: null,
          affectedPageUrls: ["https://example.com/"],
          occurrenceCount: 2,
        },
        {
          key: "js-error",
          kind: "javascript-error",
          party: "first-party",
          resourceType: null,
          resourceUrl: null,
          resourceKey: null,
          statusCode: null,
          failureClass: null,
          errorClass: "type-error",
          affectedPageUrls: ["https://example.com/"],
          occurrenceCount: 1,
        },
      ],
      suppressedThirdPartyIssueCount: 3,
      collection: {
        maxRetainedObservationCount: 400,
        retainedObservationCount: 25,
        droppedObservationCount: 2,
        truncated: true,
      },
    },
    performance: [
      {
        url: "https://example.com/",
        context: {
          viewport: { width: 1280, height: 720 },
          userAgent: "test",
          measuredAt: "2026-09-22T18:00:00.000Z",
          scanProfile: { navigationTimeoutMs: 20_000, maxPages: 20 },
          cacheState: "unknown",
          engineVersion: "test",
        },
        ttfbMs: 1_900,
        firstContentfulPaintMs: 1_000,
        largestContentfulPaintMs: 4_200,
        cumulativeLayoutShift: 0.05,
        totalBlockingTimeMs: 100,
        navigationDurationMs: 2_000,
        totalRequestCount: 40,
        transferBytes: 1_000_000,
        transferBytesByCategory: {
          javascript: 100_000,
          css: 100_000,
          images: 700_000,
          fonts: 50_000,
          other: 50_000,
        },
        cache: { responseCount: 40, cacheControlledResponseCount: 20 },
        compression: { encodedResponseCount: 20, encodings: ["br"] },
      },
    ],
    seo: {
      signals: [
        {
          code: "seo.title.missing",
          level: "warning",
          pageUrl: "https://example.com/",
          evidence: {},
        },
        {
          code: "seo.noindex",
          level: "information",
          pageUrl: "https://example.com/private",
          evidence: {},
        },
      ],
    },
    completeness: {
      crawl: { status: "partial", linkExtractionFailureCount: 1 },
      network: { status: "partial", captureFailureCount: 1 },
      performance: {
        status: "complete",
        eligiblePageCount: 1,
        observedPageCount: 1,
        observerInstalled: true,
      },
      seo: {
        status: "complete",
        eligiblePageCount: 2,
        observedPageCount: 2,
      },
    },
  };
}

describe("scanner v2 finding integration", () => {
  it("converts bounded scanner observations into reportable findings", () => {
    const findings = generateScannerV2Findings(scannerV2Fixture());

    expect(findings.map((finding) => finding.code).sort()).toEqual([
      "network.http-5xx",
      "performance.lcp.slow",
      "performance.ttfb.slow",
      "seo.noindex",
      "seo.title.missing",
    ]);
    expect(
      findings.find((finding) => finding.code === "network.http-5xx"),
    ).toMatchObject({
      category: "network",
      severity: "high",
      pageUrl: "https://example.com/app.js",
    });
    expect(
      findings.find((finding) => finding.code === "performance.lcp.slow"),
    ).toMatchObject({
      category: "performance",
      severity: "high",
    });
  });

  it("persists only compact scanner quality aggregates", () => {
    const summary = summarizeScannerV2(scannerV2Fixture());

    expect(summary).toMatchObject({
      version: 1,
      crawl: {
        discoveredUrlCount: 4,
        visitedUrlCount: 3,
        budgetReached: true,
      },
      network: {
        issueCount: 2,
        collectionTruncated: true,
      },
      performance: { observedPageCount: 1 },
      seo: { observedPageCount: 2, signalCount: 2 },
      completeness: {
        crawl: { status: "partial" },
        network: { status: "partial" },
      },
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("app.js");
    expect(serialized).not.toContain("example.com/private");
    expect(serialized).not.toContain("userAgent");
  });
});
