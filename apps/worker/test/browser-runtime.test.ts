import { describe, expect, it } from "vitest";
import type { DnsResolver } from "@agency-saas/security";
import type {
  Browser,
  BrowserContext,
  LaunchOptions,
  Page,
  Response,
} from "playwright";
import {
  isAllowedBrowserRequest,
  observeBrowserTarget,
} from "../src/browser-runtime.js";

const publicResolver: DnsResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("isolated browser runtime", () => {
  it("allows only idempotent HTTP(S) requests and local data/blob URLs", () => {
    expect(isAllowedBrowserRequest("https://example.com/", "GET")).toBe(true);
    expect(isAllowedBrowserRequest("http://example.com/", "HEAD")).toBe(true);
    expect(isAllowedBrowserRequest("https://example.com/api", "POST")).toBe(
      false,
    );
    expect(isAllowedBrowserRequest("https://example.com/api", "PUT")).toBe(
      false,
    );
    expect(isAllowedBrowserRequest("https://example.com/api", "PATCH")).toBe(
      false,
    );
    expect(isAllowedBrowserRequest("https://example.com/api", "DELETE")).toBe(
      false,
    );
    expect(isAllowedBrowserRequest("file:///etc/passwd", "GET")).toBe(false);
    expect(isAllowedBrowserRequest("data:text/plain,ok", "GET")).toBe(true);
    expect(isAllowedBrowserRequest("blob:https://example.com/id", "GET")).toBe(
      true,
    );
  });

  it("rejects private targets before launching Chromium", async () => {
    let launched = false;

    await expect(
      observeBrowserTarget("http://127.0.0.1/", {
        launchBrowser: async () => {
          launched = true;
          throw new Error("must not launch");
        },
      }),
    ).rejects.toMatchObject({ code: "non-public-ip" });

    expect(launched).toBe(false);
  });

  it("forces Chromium through the local safe proxy with direct DNS disabled", async () => {
    let launchOptions: LaunchOptions | undefined;
    let contextOptions:
      | {
          userAgent?: string;
          acceptDownloads?: boolean;
          serviceWorkers?: string;
        }
      | undefined;
    let onPage: ((page: Page) => void) | undefined;
    let contextClosed = false;
    let browserClosed = false;

    const fakePage = {
      on: () => fakePage,
      goto: async () =>
        ({
          status: () => 200,
        }) as unknown as Response,
      url: () => "https://example.com/final?token=secret#fragment",
      close: async () => undefined,
    } as unknown as Page;

    const fakeContext = {
      setDefaultNavigationTimeout: () => undefined,
      setDefaultTimeout: () => undefined,
      on: (event: string, handler: (page: Page) => void) => {
        if (event === "page") {
          onPage = handler;
        }
        return fakeContext;
      },
      route: async () => undefined,
      routeWebSocket: async () => undefined,
      newPage: async () => {
        onPage?.(fakePage);
        return fakePage;
      },
      close: async () => {
        contextClosed = true;
      },
    } as unknown as BrowserContext;

    const fakeBrowser = {
      newContext: async (options: {
        userAgent?: string;
        acceptDownloads?: boolean;
        serviceWorkers?: string;
      }) => {
        contextOptions = options;
        return fakeContext;
      },
      close: async () => {
        browserClosed = true;
      },
    } as unknown as Browser;

    const observation = await observeBrowserTarget("https://example.com/", {
      resolver: publicResolver,
      launchBrowser: async (options) => {
        launchOptions = options;
        return fakeBrowser;
      },
    });

    expect(launchOptions?.proxy?.server).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(launchOptions?.proxy?.bypass).toBe("");
    expect(launchOptions?.chromiumSandbox).toBe(true);
    expect(contextOptions).toMatchObject({
      acceptDownloads: false,
      serviceWorkers: "block",
      userAgent: "AgencyMonitor/1.0",
    });
    expect(launchOptions?.args).toEqual(
      expect.arrayContaining([
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        "--proxy-bypass-list=<-loopback>",
        "--renderer-process-limit=4",
      ]),
    );
    expect(observation).toMatchObject({
      finalUrl: "https://example.com/final",
      statusCode: 200,
      pageCount: 1,
    });
    expect(observation.durationMs).toBeGreaterThanOrEqual(0);
    expect(contextClosed).toBe(true);
    expect(browserClosed).toBe(true);
  });

  it("closes the browser and context when navigation fails", async () => {
    let contextClosed = false;
    let browserClosed = false;
    let onPage: ((page: Page) => void) | undefined;

    const failingPage = {
      on: () => failingPage,
      goto: async () => {
        throw new Error("navigation timeout");
      },
      close: async () => undefined,
    } as unknown as Page;

    const fakeContext = {
      setDefaultNavigationTimeout: () => undefined,
      setDefaultTimeout: () => undefined,
      on: (event: string, handler: (page: Page) => void) => {
        if (event === "page") {
          onPage = handler;
        }
        return fakeContext;
      },
      route: async () => undefined,
      routeWebSocket: async () => undefined,
      newPage: async () => {
        onPage?.(failingPage);
        return failingPage;
      },
      close: async () => {
        contextClosed = true;
      },
    } as unknown as BrowserContext;

    const fakeBrowser = {
      newContext: async () => fakeContext,
      close: async () => {
        browserClosed = true;
      },
    } as unknown as Browser;

    await expect(
      observeBrowserTarget("https://example.com/", {
        resolver: publicResolver,
        launchBrowser: async () => fakeBrowser,
      }),
    ).rejects.toThrow("navigation timeout");

    expect(contextClosed).toBe(true);
    expect(browserClosed).toBe(true);
  });
});
