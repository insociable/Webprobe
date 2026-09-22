import { AxeBuilder } from "@axe-core/playwright";
import {
  assertPublicHttpUrl,
  defaultDnsResolver,
  type DnsResolver,
} from "@agency-saas/security";
import type { Page } from "playwright";
import {
  createIsolatedBrowserSession,
  type BrowserRuntimeOptions,
  type IsolatedBrowserSession,
} from "./browser-runtime.js";
import type {
  AccessibilityViolationObservation,
  BrowserPageObservation,
} from "./browser-findings.js";

export type BrowserScanResult = {
  pagesVisited: number;
  observations: BrowserPageObservation[];
};

export type BrowserScanOptions = {
  resolver?: DnsResolver;
  maxPages?: number;
  navigationTimeoutMs?: number;
  checkAccessibility?: boolean;
  createSession?: (
    options: BrowserRuntimeOptions,
  ) => Promise<IsolatedBrowserSession>;
  analyzeAccessibility?: (
    page: Page,
  ) => Promise<AccessibilityViolationObservation[]>;
};

type CrawlTarget = {
  url: string;
  sourcePageUrl: string | null;
};

function boundedCrawlPages(value?: number): number {
  return Math.max(1, Math.min(value ?? 20, 20));
}

function boundedNavigationTimeout(value?: number): number {
  return Math.max(1_000, Math.min(value ?? 20_000, 60_000));
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
async function extractInternalLinks(
  page: Page,
  currentPageUrl: string,
  crawlOrigin: string,
): Promise<string[]> {
  const hrefs = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.slice(0, 100).flatMap((anchor) => {
      const href = (anchor as unknown as { href?: unknown }).href;
      return typeof href === "string" && href ? [href] : [];
    }),
  );

  return [
    ...new Set(
      hrefs.flatMap((href) => {
        const normalized = normalizeInternalLink(
          href,
          currentPageUrl,
          crawlOrigin,
        );
        return normalized ? [normalized] : [];
      }),
    ),
  ];
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
  const createSession = options.createSession ?? createIsolatedBrowserSession;
  const analyzeAccessibility =
    options.analyzeAccessibility ?? defaultAccessibilityAnalyzer;

  const initialTarget = await assertPublicHttpUrl(rawUrl, resolver);
  const session = await createSession({
    resolver,
    maxPages: 1,
    navigationTimeoutMs,
  });

  try {
    const page = await session.context.newPage();
    const pending: CrawlTarget[] = [
      {
        url: initialTarget.url.toString(),
        sourcePageUrl: null,
      },
    ];
    const seen = new Set<string>();
    const observations: BrowserPageObservation[] = [];
    let crawlOrigin: string | null = null;
    const javascriptErrorsByUrl = new Map<string, number>();

    page.on("pageerror", () => {
      try {
        const pageUrl = reportSafeUrl(page.url());
        javascriptErrorsByUrl.set(
          pageUrl,
          (javascriptErrorsByUrl.get(pageUrl) ?? 0) + 1,
        );
      } catch {
        // A transient non-HTTP document is intentionally not reported.
      }
    });

    while (pending.length > 0 && observations.length < maxPages) {
      const target = pending.shift();
      if (!target || seen.has(target.url)) {
        continue;
      }
      seen.add(target.url);
      let response;
      try {
        response = await page.goto(target.url, {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeoutMs,
        });
      } catch {
        if (!target.sourcePageUrl) {
          throw new Error("Initial browser navigation failed");
        }

        observations.push({
          url: reportSafeUrl(target.url),
          sourcePageUrl: target.sourcePageUrl,
          statusCode: null,
          navigationFailed: true,
          javascriptErrorCount: 0,
          accessibilityViolations: [],
        });
        continue;
      }

      const validatedFinal = await assertPublicHttpUrl(page.url(), resolver);
      const finalUrl = validatedFinal.url.toString();
      const reportUrl = reportSafeUrl(finalUrl);
      const statusCode = response?.status() ?? null;

      if (!crawlOrigin) {
        crawlOrigin = validatedFinal.url.origin;
      }
      const sameOrigin = validatedFinal.url.origin === crawlOrigin;
      const healthyDocument = statusCode === null || statusCode < 400;

      if (sameOrigin && healthyDocument) {
        await page.waitForTimeout(100);
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

      if (!sameOrigin || !healthyDocument || observations.length >= maxPages) {
        continue;
      }

      const links = await extractInternalLinks(page, finalUrl, crawlOrigin);
      for (const link of links) {
        if (seen.size + pending.length >= maxPages) {
          break;
        }
        if (
          seen.has(link) ||
          pending.some((candidate) => candidate.url === link)
        ) {
          continue;
        }

        pending.push({
          url: link,
          sourcePageUrl: reportUrl,
        });
      }
    }

    return {
      pagesVisited: observations.length,
      observations,
    };
  } finally {
    await session.close();
  }
}
