import { AxeBuilder } from "@axe-core/playwright";
import {
  assertPublicHttpUrl,
  defaultDnsResolver,
  type DnsResolver,
} from "@agency-saas/security";
import type { Page, Request, Response } from "playwright";
import {
  createIsolatedBrowserSession,
  type BrowserRuntimeOptions,
  type IsolatedBrowserSession,
} from "./browser-runtime.js";
import type {
  AccessibilityViolationObservation,
  BrowserPageObservation,
} from "./browser-findings.js";
import {
  CrawlCoverageTracker,
  classifyCrawlCandidate,
  type CrawlCandidate,
  type CrawlCoverage,
} from "./scanner-v2/crawl.js";
import {
  NetworkObservationCollector,
  type NetworkObservation,
  type NetworkResourceType,
} from "./scanner-v2/network.js";
import {
  createLabPerformanceObservation,
  type LabPerformanceObservation,
} from "./scanner-v2/performance.js";
import {
  installLabPerformanceObserver,
  readLabPerformanceSnapshot,
  type BrowserLabRuntimeSnapshot,
} from "./scanner-v2/performance-runtime.js";
import {
  analyzeSeoPage,
  findDuplicateSeoTitles,
  type SeoPageObservation,
  type SeoSignal,
} from "./scanner-v2/seo.js";
import { extractSeoDocumentFacts } from "./scanner-v2/seo-runtime.js";
import {
  isRobotsPathAllowed,
  parseRobotsTxt,
  type RobotsPolicy,
} from "./scanner-v2/robots.js";
import { isAllowedCanonicalOriginShift, observeUrl } from "./scanner-v2/url.js";

export type BrowserScreenshot = {
  data: Buffer;
  mediaType: "image/jpeg";
};

export type BrowserScanResult = {
  pagesVisited: number;
  observations: BrowserPageObservation[];
  screenshot: BrowserScreenshot | null;
  scannerV2: {
    crawl: CrawlCoverage;
    network: NetworkObservation;
    performance: LabPerformanceObservation[];
    seo: { pages: SeoPageObservation[]; signals: SeoSignal[] };
    completeness: ScannerV2Completeness;
  };
};

export type ScannerV2AnalyzerStatus = "complete" | "partial" | "unavailable";

export type ScannerV2Completeness = {
  crawl: {
    status: ScannerV2AnalyzerStatus;
    linkExtractionFailureCount: number;
  };
  network: {
    status: ScannerV2AnalyzerStatus;
    captureFailureCount: number;
  };
  performance: {
    status: ScannerV2AnalyzerStatus;
    eligiblePageCount: number;
    observedPageCount: number;
    observerInstalled: boolean;
  };
  seo: {
    status: ScannerV2AnalyzerStatus;
    eligiblePageCount: number;
    observedPageCount: number;
  };
};

export type BrowserScanOptions = {
  resolver?: DnsResolver;
  scanMode?: "public_audit" | "verified_monitoring";
  maxPages?: number;
  navigationTimeoutMs?: number;
  scanTimeoutMs?: number;
  networkCaptureTimeoutMs?: number;
  checkAccessibility?: boolean;
  captureScreenshot?: boolean;
  createSession?: (
    options: BrowserRuntimeOptions,
  ) => Promise<IsolatedBrowserSession>;
  analyzeAccessibility?: (
    page: Page,
  ) => Promise<AccessibilityViolationObservation[]>;
};

type CrawlTarget = {
  candidate: CrawlCandidate;
  sourcePageUrl: string | null;
};

function boundedCrawlPages(value?: number): number {
  return Math.max(1, Math.min(value ?? 20, 20));
}

function boundedNavigationTimeout(value?: number): number {
  return Math.max(1_000, Math.min(value ?? 20_000, 60_000));
}

function boundedScanTimeout(value?: number): number {
  return Math.max(100, Math.min(value ?? 120_000, 180_000));
}

function boundedNetworkCaptureTimeout(value?: number): number {
  return Math.max(100, Math.min(value ?? 2_500, 5_000));
}

type RobotsLoadResult = {
  policy: RobotsPolicy | null;
  unavailable: boolean;
};

async function loadPublicRobotsPolicy(
  page: Page,
  origin: string,
  deadline: number,
): Promise<RobotsLoadResult> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const result = await withinTimeout(
    page.evaluate(async (url) => {
      try {
        const response = await fetch(url, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          redirect: "follow",
        });
        const text =
          response.status >= 200 && response.status < 300
            ? (await response.text()).slice(0, 65_536)
            : "";
        return {
          status: response.status,
          finalUrl: response.url,
          text,
        };
      } catch {
        return null;
      }
    }, robotsUrl),
    Math.min(5_000, remainingScanTime(deadline)),
    "robots.txt collection timed out",
  ).catch(() => null);

  if (!result) {
    return { policy: null, unavailable: true };
  }

  try {
    if (new URL(result.finalUrl).origin !== origin) {
      return { policy: null, unavailable: true };
    }
  } catch {
    return { policy: null, unavailable: true };
  }

  if (result.status === 404 || result.status === 410) {
    return { policy: { rules: [], sitemaps: [] }, unavailable: false };
  }
  if (result.status < 200 || result.status >= 300) {
    return { policy: null, unavailable: true };
  }

  return {
    policy: parseRobotsTxt(result.text, "AgencyMonitor"),
    unavailable: false,
  };
}

function remainingScanTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("Browser scan deadline exceeded");
  }
  return remaining;
}

async function withinTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const maxScreenshotBytes = 2 * 1024 * 1024;

async function capturePrimaryScreenshot(
  page: Page,
): Promise<BrowserScreenshot | null> {
  try {
    const data = await page.screenshot({
      type: "jpeg",
      quality: 70,
      fullPage: false,
      animations: "disabled",
      caret: "hide",
    });

    if (data.length === 0 || data.length > maxScreenshotBytes) {
      return null;
    }

    return {
      data,
      mediaType: "image/jpeg",
    };
  } catch {
    return null;
  }
}

function reportSafeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function safeRuleId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "unknown";
}

function networkResourceType(value: string): NetworkResourceType {
  switch (value) {
    case "document":
    case "stylesheet":
    case "script":
    case "image":
    case "font":
    case "xhr":
    case "fetch":
    case "media":
      return value;
    default:
      return "other";
  }
}

function pageViewport(page: Page): { width: number; height: number } {
  const compatiblePage = page as unknown as {
    viewportSize?: () => { width: number; height: number } | null;
  };
  return compatiblePage.viewportSize?.() ?? { width: 1280, height: 720 };
}
export function normalizeInternalLink(
  rawHref: string,
  currentPageUrl: string,
  crawlOrigin: string,
): string | null {
  let url: URL;
  try {
    url = new URL(rawHref, currentPageUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.username || url.password || url.origin !== crawlOrigin) {
    return null;
  }

  url.hash = "";
  return url.toString();
}

async function defaultAccessibilityAnalyzer(
  page: Page,
): Promise<AccessibilityViolationObservation[]> {
  // Legacy mode keeps axe inside the existing page/context. The default
  // partial runner opens a temporary blank page, which our one-page browser
  // boundary intentionally rejects.
  const result = await new AxeBuilder({ page }).setLegacyMode(true).analyze();

  return result.violations.map((violation) => ({
    ruleId: safeRuleId(violation.id),
    impact:
      violation.impact === "minor" ||
      violation.impact === "moderate" ||
      violation.impact === "serious" ||
      violation.impact === "critical"
        ? violation.impact
        : null,
    nodeCount: violation.nodes.length,
  }));
}
async function extractPageHrefs(page: Page): Promise<string[]> {
  return page.locator("a[href]").evaluateAll((anchors) =>
    anchors.slice(0, 100).flatMap((anchor) => {
      const href = (anchor as unknown as { href?: unknown }).href;
      return typeof href === "string" && href ? [href] : [];
    }),
  );
}

function trackPromise(
  pending: Set<Promise<void>>,
  work: Promise<void>,
  onFailure: () => void,
): void {
  const handled = work.catch(() => onFailure());
  pending.add(handled);
  void handled.finally(() => pending.delete(handled));
}

function responseRobotsDirectives(response: Response | null): {
  values: string[];
  truncated: boolean;
} {
  if (!response) {
    return { values: [], truncated: false };
  }
  try {
    const value = response.headers()["x-robots-tag"];
    if (typeof value !== "string") {
      return { values: [], truncated: false };
    }
    const preview = value.slice(0, 512);
    if (!preview.trim()) {
      return { values: [], truncated: value.length > 512 };
    }
    return {
      values: [preview],
      truncated: value.length > 512,
    };
  } catch {
    return { values: [], truncated: false };
  }
}

function analyzerStatus(
  eligiblePageCount: number,
  observedPageCount: number,
): ScannerV2AnalyzerStatus {
  if (eligiblePageCount === 0 || observedPageCount === 0) {
    return "unavailable";
  }
  return observedPageCount < eligiblePageCount ? "partial" : "complete";
}

async function recordNetworkResponse(
  response: Response,
  pageUrl: string,
  collector: NetworkObservationCollector,
): Promise<void> {
  const request = response.request();
  const [headers, sizes] = await Promise.all([
    response.allHeaders().catch(() => null),
    request.sizes().catch(() => null),
  ]);
  collector.recordResponse(
    {
      pageUrl,
      resourceUrl: response.url(),
      resourceType: networkResourceType(request.resourceType()),
      statusCode: response.status(),
      transferBytes: sizes
        ? sizes.responseBodySize + sizes.responseHeadersSize
        : null,
      cacheControl: headers?.["cache-control"] ?? null,
      contentEncoding: headers?.["content-encoding"] ?? null,
    },
    true,
  );
}

function recordFailedNetworkRequest(
  request: Request,
  pageUrl: string,
  collector: NetworkObservationCollector,
): void {
  collector.recordFailure({
    pageUrl,
    resourceUrl: request.url(),
    resourceType: networkResourceType(request.resourceType()),
    failureCode: request.failure()?.errorText ?? null,
  });
}

export async function runBrowserScan(
  rawUrl: string,
  options: BrowserScanOptions = {},
): Promise<BrowserScanResult> {
  const resolver = options.resolver ?? defaultDnsResolver;
  const scanMode = options.scanMode ?? "verified_monitoring";
  const maxPages = boundedCrawlPages(options.maxPages);
  const navigationTimeoutMs = boundedNavigationTimeout(
    options.navigationTimeoutMs,
  );
  const scanTimeoutMs = boundedScanTimeout(options.scanTimeoutMs);
  const networkCaptureTimeoutMs = boundedNetworkCaptureTimeout(
    options.networkCaptureTimeoutMs,
  );
  const scanDeadline = Date.now() + scanTimeoutMs;
  const checkAccessibility = options.checkAccessibility ?? true;
  const captureScreenshot = options.captureScreenshot ?? false;
  const createSession = options.createSession ?? createIsolatedBrowserSession;
  const analyzeAccessibility =
    options.analyzeAccessibility ?? defaultAccessibilityAnalyzer;

  const initialTarget = await assertPublicHttpUrl(rawUrl, resolver);
  const initialCandidateResult = classifyCrawlCandidate(
    initialTarget.url.toString(),
    initialTarget.url.toString(),
    initialTarget.url.origin,
  );
  if (!initialCandidateResult.accepted) {
    throw new Error(
      "Initial browser target could not be prepared for crawling",
    );
  }
  const initialCandidate = initialCandidateResult.candidate;
  const session = await createSession({
    resolver,
    scanMode,
    maxPages: 1,
    navigationTimeoutMs,
  });

  try {
    const page = await session.context.newPage();
    const pending: CrawlTarget[] = [
      {
        candidate: initialCandidate,
        sourcePageUrl: null,
      },
    ];
    const seen = new Set<string>();
    const observations: BrowserPageObservation[] = [];
    const crawlCoverage = new CrawlCoverageTracker(maxPages);
    crawlCoverage.discover(initialCandidate, null);
    let crawlOrigin = initialTarget.url.origin;
    const networkCollector = new NetworkObservationCollector(crawlOrigin);
    let robotsPolicy: RobotsPolicy | null = null;
    let robotsPolicyLoaded = scanMode !== "public_audit";
    let stopPublicCrawl = false;
    const pendingNetworkCaptures = new Set<Promise<void>>();
    const labSnapshots: Array<{
      url: string;
      snapshot: BrowserLabRuntimeSnapshot;
    }> = [];
    const seoPages: SeoPageObservation[] = [];
    const javascriptErrorsByUrl = new Map<string, number>();
    let screenshot: BrowserScreenshot | null = null;
    let activePageUrl = initialCandidate.navigationUrl;
    let networkCaptureFailureCount = 0;
    let linkExtractionFailureCount = 0;
    let analyzedSameOriginPageCount = 0;
    let performanceEligiblePageCount = 0;
    let seoEligiblePageCount = 0;

    const performanceObserverInstalled = await installLabPerformanceObserver(
      page,
    ).catch(() => false);

    page.on("pageerror", (error) => {
      try {
        const pageUrl = reportSafeUrl(activePageUrl);
        javascriptErrorsByUrl.set(
          pageUrl,
          (javascriptErrorsByUrl.get(pageUrl) ?? 0) + 1,
        );
        networkCollector.recordJavascriptError(activePageUrl, error.message);
      } catch {
        // A transient non-HTTP document is intentionally not reported.
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        networkCollector.recordConsoleError(activePageUrl, message.text());
      }
    });
    page.on("response", (response) => {
      if (!networkCollector.reserveResponseCapture()) {
        return;
      }
      trackPromise(
        pendingNetworkCaptures,
        withinTimeout(
          recordNetworkResponse(response, activePageUrl, networkCollector),
          networkCaptureTimeoutMs,
          "Network metadata capture timed out",
        ),
        () => {
          networkCaptureFailureCount += 1;
        },
      );
    });
    page.on("requestfailed", (request) => {
      recordFailedNetworkRequest(request, activePageUrl, networkCollector);
    });

    while (pending.length > 0 && observations.length < maxPages) {
      const target = pending.shift();
      if (!target || seen.has(target.candidate.navigationUrl)) {
        continue;
      }
      seen.add(target.candidate.navigationUrl);
      activePageUrl = target.candidate.navigationUrl;
      let response;
      try {
        response = await page.goto(target.candidate.navigationUrl, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(
            navigationTimeoutMs,
            remainingScanTime(scanDeadline),
          ),
        });
      } catch {
        if (!target.sourcePageUrl) {
          throw new Error("Initial browser navigation failed");
        }

        observations.push({
          url: reportSafeUrl(target.candidate.navigationUrl),
          sourcePageUrl: target.sourcePageUrl,
          statusCode: null,
          navigationFailed: true,
          javascriptErrorCount: 0,
          accessibilityViolations: [],
        });
        crawlCoverage.markVisited(target.candidate, {
          finalUrl: target.candidate.navigationUrl,
          statusCode: null,
          navigationFailed: true,
        });
        continue;
      }

      const validatedFinal = await assertPublicHttpUrl(page.url(), resolver);
      const finalUrl = validatedFinal.url.toString();
      seen.add(finalUrl);
      const reportUrl = reportSafeUrl(finalUrl);
      const statusCode = response?.status() ?? null;

      activePageUrl = finalUrl;
      if (
        !target.sourcePageUrl &&
        validatedFinal.url.origin !== crawlOrigin &&
        isAllowedCanonicalOriginShift(
          initialTarget.url.toString(),
          validatedFinal.url.toString(),
        )
      ) {
        crawlOrigin = validatedFinal.url.origin;
        networkCollector.setFirstPartyOrigin(crawlOrigin);
      }
      const sameOrigin = validatedFinal.url.origin === crawlOrigin;
      const healthyDocument = statusCode === null || statusCode < 400;

      if (
        scanMode === "public_audit" &&
        !robotsPolicyLoaded &&
        sameOrigin &&
        healthyDocument
      ) {
        robotsPolicyLoaded = true;
        const robots = await loadPublicRobotsPolicy(
          page,
          crawlOrigin,
          scanDeadline,
        );
        robotsPolicy = robots.policy;
        if (robots.unavailable || !robots.policy) {
          crawlCoverage.markRobotsPolicyUnavailable();
          stopPublicCrawl = true;
        } else if (!isRobotsPathAllowed(robots.policy, validatedFinal.url)) {
          crawlCoverage.markRobotsRestricted();
          stopPublicCrawl = true;
        }
      }

      if (sameOrigin && healthyDocument) {
        await page.waitForTimeout(100);
      }

      if (captureScreenshot && !screenshot && sameOrigin && healthyDocument) {
        screenshot = await capturePrimaryScreenshot(page);
      }

      const accessibilityViolations =
        sameOrigin && healthyDocument && checkAccessibility
          ? await withinTimeout(
              analyzeAccessibility(page),
              remainingScanTime(scanDeadline),
              "Browser scan deadline exceeded",
            )
          : [];

      observations.push({
        url: reportUrl,
        sourcePageUrl: target.sourcePageUrl,
        statusCode,
        navigationFailed: false,
        javascriptErrorCount: sameOrigin
          ? (javascriptErrorsByUrl.get(reportUrl) ?? 0)
          : 0,
        accessibilityViolations,
      });
      crawlCoverage.markVisited(target.candidate, {
        finalUrl,
        statusCode,
        navigationFailed: false,
      });

      if (sameOrigin && healthyDocument) {
        analyzedSameOriginPageCount += 1;
        performanceEligiblePageCount += 1;
        seoEligiblePageCount += 1;
        const [labSnapshot, seoFacts] = await withinTimeout(
          Promise.all([
            readLabPerformanceSnapshot(page),
            extractSeoDocumentFacts(page),
          ]),
          remainingScanTime(scanDeadline),
          "Browser scan deadline exceeded",
        );
        if (labSnapshot) {
          labSnapshots.push({ url: finalUrl, snapshot: labSnapshot });
        }
        if (seoFacts) {
          const headerRobots = responseRobotsDirectives(response ?? null);
          const seoPage = analyzeSeoPage({
            url: finalUrl,
            statusCode,
            facts: {
              ...seoFacts,
              robots: [...seoFacts.robots, ...headerRobots.values],
              contentTruncated:
                seoFacts.contentTruncated || headerRobots.truncated,
            },
          });
          if (seoPage) {
            seoPages.push(seoPage);
          }
        }
      }

      if (
        !crawlOrigin ||
        !sameOrigin ||
        !healthyDocument ||
        observations.length >= maxPages
      ) {
        continue;
      }

      let hrefs: string[];
      try {
        hrefs = await withinTimeout(
          extractPageHrefs(page),
          remainingScanTime(scanDeadline),
          "Browser scan deadline exceeded",
        );
      } catch {
        linkExtractionFailureCount += 1;
        continue;
      }
      for (const href of hrefs) {
        const candidateResult = classifyCrawlCandidate(
          href,
          finalUrl,
          crawlOrigin,
        );
        if (!candidateResult.accepted) {
          crawlCoverage.ignore(candidateResult, reportUrl);
          continue;
        }
        const candidate = candidateResult.candidate;
        if (
          scanMode === "public_audit" &&
          (stopPublicCrawl ||
            !robotsPolicy ||
            !isRobotsPathAllowed(
              robotsPolicy,
              new URL(candidate.navigationUrl),
            ))
        ) {
          if (robotsPolicy && !stopPublicCrawl) {
            crawlCoverage.markRobotsDisallowed(candidate, reportUrl);
          }
          continue;
        }
        if (
          seen.has(candidate.navigationUrl) ||
          pending.some(
            (pendingTarget) =>
              pendingTarget.candidate.navigationUrl === candidate.navigationUrl,
          )
        ) {
          crawlCoverage.discover(candidate, reportUrl);
          continue;
        }

        if (observations.length + pending.length >= maxPages) {
          crawlCoverage.markBudgetExceeded(candidate, reportUrl);
          continue;
        }

        crawlCoverage.discover(candidate, reportUrl);
        pending.push({
          candidate,
          sourcePageUrl: reportUrl,
        });
      }
    }

    if (observations.length >= maxPages || pending.length > 0) {
      crawlCoverage.markRemainingBudgetExceeded();
    }
    if (pendingNetworkCaptures.size > 0) {
      await withinTimeout(
        Promise.all([...pendingNetworkCaptures]),
        Math.min(
          networkCaptureTimeoutMs + 100,
          remainingScanTime(scanDeadline),
        ),
        "Pending network metadata collection timed out",
      ).catch(() => {
        networkCaptureFailureCount += pendingNetworkCaptures.size;
      });
    }
    const crawl = crawlCoverage.coverage();
    const network = networkCollector.snapshot();
    const performance = labSnapshots.flatMap(({ url, snapshot }) => {
      const observedUrl = observeUrl(url);
      if (!observedUrl) {
        return [];
      }
      const observation = createLabPerformanceObservation({
        url,
        context: {
          viewport: pageViewport(page),
          userAgent: snapshot.userAgent,
          measuredAt: new Date().toISOString(),
          scanProfile: { maxPages, navigationTimeoutMs },
          cacheState: "unknown",
          engineVersion: "scanner-v2-browser-1",
        },
        timing: snapshot.timing,
        resources: network.resources.filter(
          (resource) => resource.pageUrl === observedUrl.displayUrl,
        ),
      });
      return observation ? [observation] : [];
    });
    const seoSignals = [
      ...seoPages.flatMap((pageObservation) => pageObservation.signals),
      ...findDuplicateSeoTitles(seoPages),
    ];
    const performanceStatus = analyzerStatus(
      performanceEligiblePageCount,
      performance.length,
    );
    const seoStatus = analyzerStatus(seoEligiblePageCount, seoPages.length);
    const seoAnalysisStatus =
      seoStatus === "complete" && seoPages.some((page) => page.contentTruncated)
        ? "partial"
        : seoStatus;

    return {
      pagesVisited: observations.length,
      observations,
      screenshot,
      scannerV2: {
        crawl,
        network,
        performance,
        seo: { pages: seoPages, signals: seoSignals },
        completeness: {
          crawl: {
            status:
              analyzedSameOriginPageCount === 0
                ? "unavailable"
                : linkExtractionFailureCount > 0 ||
                    crawl.budgetReached ||
                    crawl.robotsRestricted ||
                    crawl.robotsPolicyUnavailable
                  ? "partial"
                  : "complete",
            linkExtractionFailureCount,
          },
          network: {
            status:
              analyzedSameOriginPageCount === 0
                ? "unavailable"
                : networkCaptureFailureCount > 0 || network.collection.truncated
                  ? "partial"
                  : "complete",
            captureFailureCount: networkCaptureFailureCount,
          },
          performance: {
            status:
              performanceStatus === "complete" &&
              (!performanceObserverInstalled ||
                networkCaptureFailureCount > 0 ||
                network.collection.truncated)
                ? "partial"
                : performanceStatus,
            eligiblePageCount: performanceEligiblePageCount,
            observedPageCount: performance.length,
            observerInstalled: performanceObserverInstalled,
          },
          seo: {
            status: seoAnalysisStatus,
            eligiblePageCount: seoEligiblePageCount,
            observedPageCount: seoPages.length,
          },
        },
      },
    };
  } finally {
    await session.close();
  }
}
