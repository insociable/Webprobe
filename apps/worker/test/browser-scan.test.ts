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
    expect(JSON.stringify(result)).not.toContain("outside.example");
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
});
