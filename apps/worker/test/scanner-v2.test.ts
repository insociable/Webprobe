import { describe, expect, it } from "vitest";
import {
  CrawlCoverageTracker,
  classifyCrawlCandidate,
} from "../src/scanner-v2/crawl.js";
import { NetworkObservationCollector } from "../src/scanner-v2/network.js";
import { createLabPerformanceObservation } from "../src/scanner-v2/performance.js";
import {
  analyzeSeoPage,
  compareSitemapUrls,
  findDuplicateSeoTitles,
  parseRobotsTxt,
  parseSitemapXml,
} from "../src/scanner-v2/seo.js";
import { observeUrl } from "../src/scanner-v2/url.js";
import {
  crawlFixture,
  networkFixture,
  robotsFixture,
  seoFixture,
  sitemapFixture,
} from "./fixtures/scanner-v2.js";

describe("scanner v2 crawl coverage", () => {
  it("removes query strings from retained URLs while keeping a distinct identity", () => {
    expect(
      observeUrl("https://example.com/search?page=2&token=secret#top"),
    ).toMatchObject({
      displayUrl: "https://example.com/search",
      hasQuery: true,
    });
  });

  it("deduplicates normalized URL forms and link loops without losing sources", () => {
    const tracker = new CrawlCoverageTracker(3);
    const root = classifyCrawlCandidate(
      "https://example.com/",
      "https://example.com/",
      "https://example.com",
    );
    const aboutByFragment = classifyCrawlCandidate(
      "/about#team",
      "https://example.com/",
      "https://example.com",
    );
    const aboutByAbsoluteUrl = classifyCrawlCandidate(
      "https://EXAMPLE.com:443/about",
      "https://example.com/",
      "https://example.com",
    );
    if (
      !root.accepted ||
      !aboutByFragment.accepted ||
      !aboutByAbsoluteUrl.accepted
    ) {
      throw new Error("fixture candidates must be accepted");
    }

    tracker.discover(root.candidate, null);
    tracker.discover(aboutByFragment.candidate, root.candidate.displayUrl);
    tracker.discover(aboutByAbsoluteUrl.candidate, root.candidate.displayUrl);
    tracker.discover(root.candidate, aboutByFragment.candidate.displayUrl);

    const coverage = tracker.coverage();
    expect(coverage.discoveredUrlCount).toBe(2);
    expect(coverage.urls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/about",
          sourcePageUrls: ["https://example.com/"],
          duplicateDiscoveryCount: 1,
        }),
        expect.objectContaining({
          url: "https://example.com/",
          sourcePageUrls: ["https://example.com/about"],
          duplicateDiscoveryCount: 1,
        }),
      ]),
    );
  });

  it("records redirects, exclusions and pages left outside the page budget", () => {
    const tracker = new CrawlCoverageTracker(2);
    const root = classifyCrawlCandidate(
      crawlFixture.root,
      crawlFixture.root,
      "https://example.com",
    );
    const redirected = classifyCrawlCandidate(
      "/old",
      crawlFixture.root,
      "https://example.com",
    );
    const outside = classifyCrawlCandidate(
      crawlFixture.external,
      crawlFixture.root,
      "https://example.com",
    );
    const budget = classifyCrawlCandidate(
      "/unvisited",
      crawlFixture.root,
      "https://example.com",
    );
    expect(root.accepted).toBe(true);
    expect(redirected.accepted).toBe(true);
    expect(outside).toMatchObject({
      accepted: false,
      reason: "external-origin",
    });
    expect(budget.accepted).toBe(true);
    if (!root.accepted || !redirected.accepted || budget.accepted === false) {
      throw new Error("fixture candidates must be accepted");
    }

    tracker.discover(root.candidate, null);
    tracker.markVisited(root.candidate, {
      finalUrl: crawlFixture.root,
      statusCode: 200,
      navigationFailed: false,
    });
    tracker.discover(redirected.candidate, crawlFixture.root);
    const redirectDestination = classifyCrawlCandidate(
      crawlFixture.final,
      crawlFixture.root,
      "https://example.com",
    );
    expect(redirectDestination.accepted).toBe(true);
    if (!redirectDestination.accepted) {
      throw new Error("redirect destination must be accepted");
    }
    tracker.discover(redirectDestination.candidate, crawlFixture.root);
    tracker.markVisited(redirected.candidate, {
      finalUrl: crawlFixture.final,
      statusCode: 200,
      navigationFailed: false,
    });
    tracker.ignore(outside);
    tracker.markBudgetExceeded(budget.candidate, crawlFixture.root);

    expect(tracker.coverage()).toMatchObject({
      maxPages: 2,
      visitedUrlCount: 2,
      ignoredUrlCount: 1,
      unvisitedUrlCount: 1,
      budgetReached: true,
      redirects: [
        expect.objectContaining({
          fromUrl: crawlFixture.redirected,
          toUrl: "https://example.com/new",
        }),
      ],
    });
    expect(
      tracker
        .coverage()
        .urls.find((entry) => entry.url === "https://example.com/new"),
    ).toBeUndefined();
  });
});

describe("scanner v2 network observations", () => {
  it("groups first-party resource failures and suppresses third-party issue noise", () => {
    const collector = new NetworkObservationCollector("https://example.com");
    collector.recordResponse({
      pageUrl: crawlFixture.root,
      resourceUrl: networkFixture.firstPartyScript404,
      resourceType: "script",
      statusCode: 404,
      transferBytes: 0,
      cacheControl: "max-age=60",
      contentEncoding: null,
    });
    collector.recordResponse({
      pageUrl: "https://example.com/about",
      resourceUrl: networkFixture.firstPartyScript404,
      resourceType: "script",
      statusCode: 404,
      transferBytes: 0,
      cacheControl: "max-age=60",
      contentEncoding: null,
    });
    collector.recordResponse({
      pageUrl: crawlFixture.root,
      resourceUrl: networkFixture.firstPartyImage404,
      resourceType: "image",
      statusCode: 404,
      transferBytes: 0,
      cacheControl: null,
      contentEncoding: null,
    });
    collector.recordFailure({
      pageUrl: crawlFixture.root,
      resourceUrl: networkFixture.firstPartyStyleFailure,
      resourceType: "stylesheet",
      failureCode: "net::ERR_ABORTED",
    });
    collector.recordFailure({
      pageUrl: crawlFixture.root,
      resourceUrl: networkFixture.thirdPartyFailure,
      resourceType: "script",
      failureCode: "net::ERR_NAME_NOT_RESOLVED",
    });
    collector.recordConsoleError(
      crawlFixture.root,
      "ReferenceError: app is not defined",
    );

    const observation = collector.snapshot();
    expect(observation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "http-4xx",
          resourceType: "script",
          affectedPageUrls: [
            "https://example.com/",
            "https://example.com/about",
          ],
          occurrenceCount: 2,
        }),
        expect.objectContaining({
          kind: "request-failed",
          resourceType: "stylesheet",
          failureClass: "aborted",
        }),
        expect.objectContaining({
          kind: "console-error",
          errorClass: "reference-error",
        }),
      ]),
    );
    expect(observation.suppressedThirdPartyIssueCount).toBe(1);
    expect(observation.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceUrl: networkFixture.thirdPartyFailure,
        }),
      ]),
    );
  });

  it("truncates hostile browser event volume instead of retaining it unbounded", () => {
    const collector = new NetworkObservationCollector("https://example.com", 2);
    collector.recordResponse({
      pageUrl: crawlFixture.root,
      resourceUrl: "https://example.com/first.js",
      resourceType: "script",
      statusCode: 200,
      transferBytes: 1,
      cacheControl: null,
      contentEncoding: null,
    });
    collector.recordFailure({
      pageUrl: crawlFixture.root,
      resourceUrl: "https://example.com/second.js",
      resourceType: "script",
      failureCode: "net::ERR_TIMED_OUT",
    });
    collector.recordConsoleError(
      crawlFixture.root,
      "ReferenceError: this third event must be dropped",
    );

    expect(collector.snapshot()).toMatchObject({
      resources: [
        expect.objectContaining({
          resourceUrl: "https://example.com/first.js",
        }),
      ],
      failedRequests: [
        expect.objectContaining({
          resourceUrl: "https://example.com/second.js",
          failureClass: "timeout",
        }),
      ],
      consoleErrors: [],
      collection: {
        maxRetainedObservationCount: 2,
        retainedObservationCount: 2,
        droppedObservationCount: 1,
        truncated: true,
      },
    });
  });
});

describe("scanner v2 performance lab", () => {
  it("preserves slow-page lab measurements without claiming field data", () => {
    const observation = createLabPerformanceObservation({
      url: crawlFixture.root,
      context: {
        viewport: { width: 1440, height: 900 },
        userAgent: "AgencyMonitorTest/1.0",
        measuredAt: "2026-09-22T10:00:00.000Z",
        scanProfile: { maxPages: 2, navigationTimeoutMs: 20_000 },
        cacheState: "unknown",
        engineVersion: "scanner-v2",
      },
      timing: {
        requestStart: 10,
        responseStart: 110,
        domContentLoadedEventEnd: 12_010,
        firstContentfulPaint: 180,
        largestContentfulPaint: 420,
        cumulativeLayoutShift: 0.08,
        totalBlockingTime: 35,
      },
      resources: [
        {
          pageUrl: crawlFixture.root,
          resourceUrl: "https://example.com/app.js",
          resourceKey: "a",
          resourceType: "script",
          party: "first-party",
          statusCode: 200,
          transferBytes: 1200,
          cacheControlled: true,
          contentEncoding: "br",
        },
        {
          pageUrl: crawlFixture.root,
          resourceUrl: "https://example.com/logo.png",
          resourceKey: "b",
          resourceType: "image",
          party: "first-party",
          statusCode: 200,
          transferBytes: 800,
          cacheControlled: false,
          contentEncoding: null,
        },
      ],
    });

    expect(observation).toMatchObject({
      ttfbMs: 100,
      navigationDurationMs: 12_000,
      totalRequestCount: 2,
      transferBytes: 2000,
      transferBytesByCategory: { javascript: 1200, images: 800 },
      compression: { encodings: ["br"] },
      context: { cacheState: "unknown" },
    });
  });
});

describe("scanner v2 SEO", () => {
  it("keeps facts separate from conservative SEO signals", () => {
    const complete = analyzeSeoPage({
      url: crawlFixture.root,
      statusCode: 200,
      facts: seoFixture.complete,
    });
    const noindex = analyzeSeoPage({
      url: "https://example.com/private",
      statusCode: 200,
      facts: seoFixture.noindexMultipleH1,
    });
    const missing = analyzeSeoPage({
      url: "https://example.com/missing",
      statusCode: 404,
      facts: seoFixture.missingTitle,
    });
    expect(complete?.titleLength).toBe(seoFixture.complete.title.length);
    expect(JSON.stringify(complete)).not.toContain(seoFixture.complete.title);
    expect(JSON.stringify(complete)).not.toContain(
      seoFixture.complete.metaDescription,
    );
    expect(noindex?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "seo.noindex", level: "information" }),
        expect.objectContaining({
          code: "seo.h1.multiple",
          level: "information",
        }),
      ]),
    );
    expect(missing?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "seo.http-error", level: "error" }),
        expect.objectContaining({
          code: "seo.title.missing",
          level: "warning",
        }),
        expect.objectContaining({
          code: "seo.meta-description.missing",
          level: "opportunity",
        }),
        expect.objectContaining({
          code: "seo.canonical.invalid",
          level: "error",
        }),
      ]),
    );

    const contradictoryRobots = analyzeSeoPage({
      url: crawlFixture.root,
      statusCode: 200,
      facts: {
        ...seoFixture.complete,
        robots: ["index, follow", "googlebot: noindex"],
      },
    });
    expect(contradictoryRobots).toMatchObject({
      robots: ["follow", "index", "noindex"],
      indexability: "noindex",
    });

    const truncated = analyzeSeoPage({
      url: crawlFixture.root,
      statusCode: 200,
      facts: { ...seoFixture.complete, contentTruncated: true },
    });
    expect(truncated).toMatchObject({
      contentTruncated: true,
      titleFingerprint: null,
    });
  });

  it("parses local robots/sitemap fixtures and compares coverage", () => {
    expect(parseRobotsTxt(robotsFixture)).toEqual({
      sitemaps: ["https://example.com/sitemap.xml"],
      rules: [{ userAgent: "*", allow: ["/public/"], disallow: ["/private/"] }],
    });
    expect(parseSitemapXml(sitemapFixture)).toEqual([
      "https://example.com/",
      "https://example.com/unvisited",
    ]);
    expect(
      compareSitemapUrls(parseSitemapXml(sitemapFixture), [crawlFixture.root]),
    ).toEqual({
      sitemapOnlyUrls: ["https://example.com/unvisited"],
      crawledOnlyUrls: [],
    });
    expect(
      parseSitemapXml(
        "<urlset><url><loc>https://example.com/private?token=secret</loc></url><url><loc>ftp://example.com/ignored</loc></url></urlset>",
      ),
    ).toEqual(["https://example.com/private"]);
  });

  it("finds duplicates only after multiple page facts are available", () => {
    const first = analyzeSeoPage({
      url: crawlFixture.root,
      statusCode: 200,
      facts: seoFixture.complete,
    });
    const second = analyzeSeoPage({
      url: "https://example.com/about",
      statusCode: 200,
      facts: seoFixture.complete,
    });
    if (!first || !second) {
      throw new Error("expected valid SEO observations");
    }
    expect(findDuplicateSeoTitles([first, second])).toHaveLength(2);
  });
});
