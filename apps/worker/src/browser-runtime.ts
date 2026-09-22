import { performance } from "node:perf_hooks";
import {
  assertPublicHttpUrl,
  defaultDnsResolver,
  type DnsResolver,
} from "@agency-saas/security";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
} from "playwright";
import {
  startSafeBrowserProxy,
  type SafeBrowserProxy,
} from "./safe-browser-proxy.js";

export type BrowserRuntimeObservation = {
  finalUrl: string;
  statusCode: number | null;
  pageCount: number;
  durationMs: number;
};

export type BrowserRuntimeOptions = {
  resolver?: DnsResolver;
  navigationTimeoutMs?: number;
  maxPages?: number;
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
};

export type IsolatedBrowserSession = {
  browser: Browser;
  context: BrowserContext;
  proxy: SafeBrowserProxy;
  pageCount(): number;
  close(): Promise<void>;
};

const allowedBrowserMethods = new Set(["GET", "HEAD", "OPTIONS"]);

const chromiumSafetyArgs = [
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-dev-shm-usage",
  "--disable-quic",
  "--disable-sync",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  "--js-flags=--max-old-space-size=256",
  "--no-default-browser-check",
  "--no-first-run",
  "--proxy-bypass-list=<-loopback>",
  "--renderer-process-limit=4",
] as const;

function boundedNavigationTimeout(value?: number): number {
  return Math.max(1_000, Math.min(value ?? 20_000, 60_000));
}

function boundedMaxPages(value?: number): number {
  return Math.max(1, Math.min(value ?? 1, 5));
}

export function isAllowedBrowserRequest(
  rawUrl: string,
  method: string,
): boolean {
  let protocol: string;
  try {
    protocol = new URL(rawUrl).protocol;
  } catch {
    return false;
  }

  if (protocol === "data:" || protocol === "blob:") {
    return true;
  }

  return (
    (protocol === "http:" || protocol === "https:") &&
    allowedBrowserMethods.has(method.toUpperCase())
  );
}

function reportSafeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function closeQuietly(
  context: BrowserContext | undefined,
  browser: Browser | undefined,
  proxy: SafeBrowserProxy | undefined,
): Promise<void> {
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await proxy?.close().catch(() => undefined);
}

export async function createIsolatedBrowserSession(
  options: BrowserRuntimeOptions = {},
): Promise<IsolatedBrowserSession> {
  const resolver = options.resolver ?? defaultDnsResolver;
  const navigationTimeoutMs = boundedNavigationTimeout(
    options.navigationTimeoutMs,
  );
  const maxPages = boundedMaxPages(options.maxPages);
  const launchBrowser =
    options.launchBrowser ??
    ((launchOptions: LaunchOptions) => chromium.launch(launchOptions));

  let proxy: SafeBrowserProxy | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    proxy = await startSafeBrowserProxy({
      resolver,
      connectTimeoutMs: Math.min(navigationTimeoutMs, 10_000),
      maxTunnelDurationMs: Math.min(
        Math.max(navigationTimeoutMs * 2, 15_000),
        120_000,
      ),
    });
    browser = await launchBrowser({
      headless: true,
      chromiumSandbox: true,
      timeout: Math.min(navigationTimeoutMs, 15_000),
      proxy: {
        server: proxy.url,
        bypass: "",
      },
      args: [...chromiumSafetyArgs],
    });

    context = await browser.newContext({
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      serviceWorkers: "block",
    });
    context.setDefaultNavigationTimeout(navigationTimeoutMs);
    context.setDefaultTimeout(navigationTimeoutMs);

    let openedPageCount = 0;
    context.on("page", (openedPage) => {
      openedPageCount += 1;
      if (openedPageCount > maxPages) {
        void openedPage.close().catch(() => undefined);
      }
    });

    await context.route("**/*", async (route) => {
      const request = route.request();
      if (isAllowedBrowserRequest(request.url(), request.method())) {
        await route.continue();
        return;
      }

      await route.abort("blockedbyclient");
    });

    await context.routeWebSocket(/.*/, (webSocket) => {
      webSocket.close();
    });
    const sessionProxy = proxy;
    const sessionBrowser = browser;
    const sessionContext = context;

    return {
      proxy: sessionProxy,
      browser: sessionBrowser,
      context: sessionContext,
      pageCount: () => Math.min(openedPageCount, maxPages),
      async close(): Promise<void> {
        await closeQuietly(sessionContext, sessionBrowser, sessionProxy);
      },
    };
  } catch (error) {
    await closeQuietly(context, browser, proxy);
    throw error;
  }
}

export async function observeBrowserTarget(
  rawUrl: string,
  options: BrowserRuntimeOptions = {},
): Promise<BrowserRuntimeObservation> {
  const resolver = options.resolver ?? defaultDnsResolver;
  const navigationTimeoutMs = boundedNavigationTimeout(
    options.navigationTimeoutMs,
  );
  const validatedTarget = await assertPublicHttpUrl(rawUrl, resolver);
  const startedAt = performance.now();
  const session = await createIsolatedBrowserSession(options);

  try {
    const page = await session.context.newPage();
    const response = await page.goto(validatedTarget.url.toString(), {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    });

    const finalTarget = await assertPublicHttpUrl(page.url(), resolver);
    return {
      finalUrl: reportSafeUrl(finalTarget.url.toString()),
      statusCode: response?.status() ?? null,
      pageCount: session.pageCount(),
      durationMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    await session.close();
  }
}
