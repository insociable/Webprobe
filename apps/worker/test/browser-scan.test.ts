import { describe, expect, it } from "vitest";
import type { DnsResolver } from "@agency-saas/security";
import type { BrowserContext, Page, Response } from "playwright";
import type { IsolatedBrowserSession } from "../src/browser-runtime.js";
import { normalizeInternalLink, runBrowserScan } from "../src/browser-scan.js";

const publicResolver: DnsResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("browser crawl", () => {
  it("normalizes only same-origin HTTP(S) links", () => {
    expect(
      normalizeInternalLink(
        "/next?token=secret#section",
        "https://example.com/start",
        "https://example.com",
      ),
    ).toBe("https://example.com/next?token=secret");

    expect(
      normalizeInternalLink(
        "https://outside.example/page",
        "https://example.com/start",
        "https://example.com",
      ),
    ).toBeNull();
    expect(
      normalizeInternalLink(
        "mailto:test@example.com",
        "https://example.com/start",
        "https://example.com",
      ),
    ).toBeNull();
    expect(
      normalizeInternalLink(
        "https://user:pass@example.com/private",
        "https://example.com/start",
        "https://example.com",
      ),
    ).toBeNull();
  });

  it("crawls bounded internal pages and records safe observations", async () => {
    let currentUrl = "about:blank";
    let pageErrorHandler: (() => void) | undefined;
    let sessionClosed = false;
    let requestedSessionMaxPages: number | undefined;

    const linksByUrl = new Map<string, string[]>([
      [
        "https://example.com/",
        [
          "https://example.com/ok?token=secret#fragment",
          "https://example.com/bad",
          "https://outside.example/",
          "mailto:test@example.com",
        ],
      ],
      ["https://example.com/ok?token=secret", ["https://example.com/down"]],
    ]);

    const fakePage = {
      on: (event: string, handler: () => void) => {
        if (event === "pageerror") {
          pageErrorHandler = handler;
        }
        return fakePage;
      },
      goto: async (url: string) => {
        currentUrl = url;
        if (url.endsWith("/down")) {
          throw new Error("secret navigation detail");
        }
        if (url.includes("/ok?")) {
          pageErrorHandler?.();
        }
        const status = url.endsWith("/bad") ? 404 : 200;
        return { status: () => status } as unknown as Response;
      },
      url: () => currentUrl,
      waitForTimeout: async () => undefined,
      locator: () => ({
        evaluateAll: async (callback: (anchors: unknown[]) => string[]) =>
          callback(
            (linksByUrl.get(currentUrl) ?? []).map((href) => ({ href })),
          ),
      }),
    } as unknown as Page;

    const fakeContext = {
      newPage: async () => fakePage,
    } as unknown as BrowserContext;

    const createSession = async (options: {
      maxPages?: number;
    }): Promise<IsolatedBrowserSession> => {
      requestedSessionMaxPages = options.maxPages;
      return {
        browser: {} as IsolatedBrowserSession["browser"],
        context: fakeContext,
        proxy: {} as IsolatedBrowserSession["proxy"],
        pageCount: () => 1,
        close: async () => {
          sessionClosed = true;
        },
      };
    };

    const result = await runBrowserScan("https://example.com/", {
      resolver: publicResolver,
      maxPages: 4,
      navigationTimeoutMs: 5_000,
      createSession,
      analyzeAccessibility: async (page) => {
        const url = page.url();
        return url.endsWith("/bad")
          ? []
          : [
              {
                ruleId: "color-contrast",
                impact: "serious",
                nodeCount: 2,
              },
            ];
      },
    });

    expect(requestedSessionMaxPages).toBe(1);
    expect(sessionClosed).toBe(true);
    expect(result.pagesVisited).toBe(4);
    expect(result.screenshot).toBeNull();
    expect(result.observations.map((item) => item.url)).toEqual([
      "https://example.com/",
      "https://example.com/ok",
      "https://example.com/bad",
      "https://example.com/down",
    ]);
    expect(result.observations[1]).toMatchObject({
      sourcePageUrl: "https://example.com/",
      statusCode: 200,
      navigationFailed: false,
      javascriptErrorCount: 1,
    });
    expect(result.observations[1]?.accessibilityViolations).toEqual([
      {
        ruleId: "color-contrast",
        impact: "serious",
        nodeCount: 2,
      },
    ]);
    expect(result.observations[2]).toMatchObject({
      statusCode: 404,
      accessibilityViolations: [],
    });
    expect(result.observations[3]).toMatchObject({
      sourcePageUrl: "https://example.com/ok",
      statusCode: null,
      navigationFailed: true,
      javascriptErrorCount: 0,
      accessibilityViolations: [],
    });
    expect(JSON.stringify(result)).not.toContain("token=secret");
    expect(JSON.stringify(result)).not.toContain("navigation detail");
    expect(result.observations.map((item) => item.url)).not.toContain(
      "https://outside.example/",
    );
    expect(result.scannerV2.crawl.urls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://outside.example/",
          state: "ignored",
          exclusionReason: "external-origin",
        }),
      ]),
    );
  });

  it("skips axe when accessibility checks are disabled", async () => {
    let analyzed = false;
    const fakePage = {
      on: () => fakePage,
      goto: async (url: string) => {
        currentUrl = url;
        return { status: () => 200 } as unknown as Response;
      },
      url: () => currentUrl,
      waitForTimeout: async () => undefined,
      locator: () => ({
        evaluateAll: async () => [],
      }),
    } as unknown as Page;
    let currentUrl = "about:blank";

    const result = await runBrowserScan("https://example.com/", {
      resolver: publicResolver,
      checkAccessibility: false,
      createSession: async () =>
        ({
          browser: {},
          context: {
            newPage: async () => fakePage,
          },
          proxy: {},
          pageCount: () => 1,
          close: async () => undefined,
        }) as unknown as IsolatedBrowserSession,
      analyzeAccessibility: async () => {
        analyzed = true;
        return [];
      },
    });

    expect(analyzed).toBe(false);
    expect(result.pagesVisited).toBe(1);
  });

  it("captures one bounded primary screenshot when enabled", async () => {
    let currentUrl = "about:blank";
    let screenshotCalls = 0;
    const fakePage = {
      on: () => fakePage,
      goto: async (url: string) => {
        currentUrl = url;
        return { status: () => 200 } as unknown as Response;
      },
      url: () => currentUrl,
      waitForTimeout: async () => undefined,
      screenshot: async () => {
        screenshotCalls += 1;
        return Buffer.from("fake-jpeg");
      },
      locator: () => ({
        evaluateAll: async () => [],
      }),
    } as unknown as Page;

    const result = await runBrowserScan("https://example.com/", {
      resolver: publicResolver,
      checkAccessibility: false,
      captureScreenshot: true,
      createSession: async () =>
        ({
          browser: {},
          context: { newPage: async () => fakePage },
          proxy: {},
          pageCount: () => 1,
          close: async () => undefined,
        }) as unknown as IsolatedBrowserSession,
    });

    expect(screenshotCalls).toBe(1);
    expect(result.screenshot?.mediaType).toBe("image/jpeg");
    expect(result.screenshot?.data.equals(Buffer.from("fake-jpeg"))).toBe(true);
  });

  it("keeps the browser scan successful when screenshot capture fails", async () => {
    let currentUrl = "about:blank";
    const fakePage = {
      on: () => fakePage,
      goto: async (url: string) => {
        currentUrl = url;
        return { status: () => 200 } as unknown as Response;
      },
      url: () => currentUrl,
      waitForTimeout: async () => undefined,
      screenshot: async () => {
        throw new Error("capture failed");
      },
      locator: () => ({
        evaluateAll: async () => [],
      }),
    } as unknown as Page;

    const result = await runBrowserScan("https://example.com/", {
      resolver: publicResolver,
      checkAccessibility: false,
      captureScreenshot: true,
      createSession: async () =>
        ({
          browser: {},
          context: { newPage: async () => fakePage },
          proxy: {},
          pageCount: () => 1,
          close: async () => undefined,
        }) as unknown as IsolatedBrowserSession,
    });

    expect(result.pagesVisited).toBe(1);
    expect(result.screenshot).toBeNull();
  });

  it("returns structured scanner v2 observations without persisting them", async () => {
    let currentUrl = "about:blank";
    const handlers: Record<string, ((value: unknown) => void) | undefined> = {};
    const scriptResponse = {
      request: () => ({
        resourceType: () => "script",
        sizes: async () => ({
          responseBodySize: 1200,
          responseHeadersSize: 80,
        }),
      }),
      allHeaders: async () => ({
        "cache-control": "public, max-age=60",
        "content-encoding": "br",
      }),
      url: () => "https://example.com/assets/app.js",
      status: () => 404,
    } as unknown as Response;
    const stylesheetRequest = {
      resourceType: () => "stylesheet",
      url: () => "https://example.com/assets/site.css",
      failure: () => ({ errorText: "net::ERR_ABORTED" }),
    };
    const fakePage = {
      on: (event: string, handler: (value: unknown) => void) => {
        handlers[event] = handler;
        return fakePage;
      },
      addInitScript: async () => undefined,
      evaluate: async (expression: string) =>
        expression.includes("__agencyMonitorLabPerformanceV2")
          ? {
              timing: {
                requestStart: 10,
                responseStart: 110,
                domContentLoadedEventEnd: 510,
                firstContentfulPaint: 160,
                largestContentfulPaint: 400,
                cumulativeLayoutShift: 0.04,
                totalBlockingTime: 20,
              },
              userAgent: "AgencyMonitorTest/1.0",
            }
          : {
              title: "Accueil Example",
              metaDescription: "Description test",
              canonicalHref: "/",
              robots: ["index, follow"],
              lang: "fr",
              h1Count: 1,
              internalLinkCount: 0,
              sitemapHrefs: ["/sitemap.xml"],
            },
      goto: async (url: string) => {
        currentUrl = url;
        handlers.response?.(scriptResponse);
        handlers.requestfailed?.(stylesheetRequest);
        handlers.console?.({
          type: () => "error",
          text: () => "ReferenceError: app",
        });
        handlers.pageerror?.(new Error("ReferenceError: app"));
        return { status: () => 200 } as unknown as Response;
      },
      url: () => currentUrl,
      viewportSize: () => ({ width: 1440, height: 900 }),
      waitForTimeout: async () => undefined,
      locator: () => ({ evaluateAll: async () => [] }),
    } as unknown as Page;

    const result = await runBrowserScan("https://example.com/", {
      resolver: publicResolver,
      checkAccessibility: false,
      createSession: async () =>
        ({
          browser: {},
          context: { newPage: async () => fakePage },
          proxy: {},
          pageCount: () => 1,
          close: async () => undefined,
        }) as unknown as IsolatedBrowserSession,
    });

    expect(result.scannerV2.crawl).toMatchObject({
      visitedUrlCount: 1,
      budgetReached: false,
    });
    expect(result.scannerV2.network.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "http-4xx", resourceType: "script" }),
        expect.objectContaining({
          kind: "request-failed",
          resourceType: "stylesheet",
        }),
        expect.objectContaining({ kind: "console-error" }),
        expect.objectContaining({ kind: "javascript-error" }),
      ]),
    );
    expect(result.scannerV2.performance).toEqual([
      expect.objectContaining({
        ttfbMs: 100,
        totalRequestCount: 1,
        transferBytes: 1280,
        transferBytesByCategory: expect.objectContaining({ javascript: 1280 }),
      }),
    ]);
    expect(result.scannerV2.seo.pages).toEqual([
      expect.objectContaining({
        title: "Accueil Example",
        canonicalStatus: "valid",
        sitemapUrls: ["https://example.com/sitemap.xml"],
      }),
    ]);
  });
});
