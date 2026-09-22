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
import { observeUrl } from "./scanner-v2/url.js";

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
  };
};

export type BrowserScanOptions = {
  resolver?: DnsResolver;
  maxPages?: number;
  navigationTimeoutMs?: number;
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

function trackPromise(pending: Set<Promise<void>>, work: Promise<void>): void {
  const handled = work.catch(() => undefined);
  pending.add(handled);
  void handled.finally(() => pending.delete(handled));
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
  collector.recordResponse({
    pageUrl,
    resourceUrl: response.url(),
    resourceType: networkResourceType(request.resourceType()),
    statusCode: response.status(),
    transferBytes: sizes
      ? sizes.responseBodySize + sizes.responseHeadersSize
      : null,
    cacheControl: headers?.["cache-control"] ?? null,
    contentEncoding: headers?.["content-encoding"] ?? null,
  });
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
  const maxPages = boundedCrawlPages(options.maxPages);
  const navigationTimeoutMs = boundedNavigationTimeout(
    options.navigationTimeoutMs,
  );
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
    const networkCollector = new NetworkObservationCollector(
      initialTarget.url.origin,
    );
    const pendingNetworkCaptures = new Set<Promise<void>>();
    const labSnapshots: Array<{
      url: string;
      snapshot: BrowserLabRuntimeSnapshot;
    }> = [];
    const seoPages: SeoPageObservation[] = [];
    let crawlOrigin: string | null = null;
    const javascriptErrorsByUrl = new Map<string, number>();
    let screenshot: BrowserScreenshot | null = null;
    let activePageUrl = initialCandidate.navigationUrl;

    await installLabPerformanceObserver(page).catch(() => false);

    page.on("pageerror", (error) => {
      try {
        const pageUrl = reportSafeUrl(page.url());
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
      trackPromise(
        pendingNetworkCaptures,
        recordNetworkResponse(response, activePageUrl, networkCollector),
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
          timeout: navigationTimeoutMs,
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
      const reportUrl = reportSafeUrl(finalUrl);
      const statusCode = response?.status() ?? null;

      if (!crawlOrigin) {
        crawlOrigin = validatedFinal.url.origin;
        networkCollector.setFirstPartyOrigin(crawlOrigin);
      }
      const sameOrigin = validatedFinal.url.origin === crawlOrigin;
      const healthyDocument = statusCode === null || statusCode < 400;

      if (sameOrigin && healthyDocument) {
        await page.waitForTimeout(100);
      }

      if (captureScreenshot && !screenshot && sameOrigin && healthyDocument) {
        screenshot = await capturePrimaryScreenshot(page);
      }

      const accessibilityViolations =
        sameOrigin && healthyDocument && checkAccessibility
          ? await analyzeAccessibility(page)
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
        const [labSnapshot, seoFacts] = await Promise.all([
          readLabPerformanceSnapshot(page),
          extractSeoDocumentFacts(page),
        ]);
        if (labSnapshot) {
          labSnapshots.push({ url: finalUrl, snapshot: labSnapshot });
        }
        if (seoFacts) {
          const seoPage = analyzeSeoPage({
            url: finalUrl,
            statusCode,
            facts: seoFacts,
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

      const hrefs = await extractPageHrefs(page);
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
          seen.has(candidate.navigationUrl) ||
          pending.some(
            (pendingTarget) =>
              pendingTarget.candidate.navigationUrl === candidate.navigationUrl,
          )
        ) {
          crawlCoverage.discover(candidate, reportUrl);
          continue;
        }

        if (seen.size + pending.length >= maxPages) {
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
    await Promise.all([...pendingNetworkCaptures]);
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

    return {
      pagesVisited: observations.length,
      observations,
      screenshot,
      scannerV2: {
        crawl: crawlCoverage.coverage(),
        network,
        performance,
        seo: { pages: seoPages, signals: seoSignals },
      },
    };
  } finally {
    await session.close();
  }
}
