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

export type BrowserRequestPolicyInput = {
  url: string;
  method: string;
  resourceType: string;
  isNavigationRequest: boolean;
  redirectedFromUrl: string | null;
};

export type BrowserRequestPolicy = (
  request: BrowserRequestPolicyInput,
) => boolean | Promise<boolean>;

export type BrowserRequestBudgetSnapshot = {
  total: number;
  blocked: number;
  exhausted: boolean;
  byHostname: Record<string, number>;
};

export type BrowserRuntimeOptions = {
  resolver?: DnsResolver;
  navigationTimeoutMs?: number;
  maxPages?: number;
  scanMode?: "public_audit" | "verified_monitoring";
  maxRequests?: number;
  maxRequestsPerHostname?: number;
  requestPolicy?: BrowserRequestPolicy;
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
};

export type IsolatedBrowserSession = {
  browser: Browser;
  context: BrowserContext;
  proxy: SafeBrowserProxy;
  pageCount(): number;
  requestBudget?(): BrowserRequestBudgetSnapshot;
  close(): Promise<void>;
};

const verifiedMonitoringMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const publicAuditMethods = new Set(["GET", "HEAD"]);
const defaultBrowserUserAgent = "AgencyMonitor/1.0";
const defaultPublicAuditMaxRequests = 200;
const defaultPublicAuditMaxRequestsPerHostname = 80;

export function browserUserAgent(): string {
  const configured = process.env.AGENCY_MONITOR_USER_AGENT?.trim();
  return configured && configured.length <= 200
    ? configured
    : defaultBrowserUserAgent;
}

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

function boundedRequestLimit(
  value: number | undefined,
  fallback: number,
): number {
  return Math.max(1, Math.min(value ?? fallback, 1_000));
}

export function isAllowedBrowserRequest(
  rawUrl: string,
  method: string,
  scanMode: "public_audit" | "verified_monitoring" = "verified_monitoring",
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

  const allowedMethods =
    scanMode === "public_audit"
      ? publicAuditMethods
      : verifiedMonitoringMethods;
  return (
    (protocol === "http:" || protocol === "https:") &&
    allowedMethods.has(method.toUpperCase())
  );
}

function reportSafeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.username = "";
  url.password = "";
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
  const scanMode = options.scanMode ?? "verified_monitoring";
  const navigationTimeoutMs = boundedNavigationTimeout(
    options.navigationTimeoutMs,
  );
  const maxPages = boundedMaxPages(options.maxPages);
  const maxRequests = boundedRequestLimit(
    options.maxRequests,
    defaultPublicAuditMaxRequests,
  );
  const maxRequestsPerHostname = boundedRequestLimit(
    options.maxRequestsPerHostname,
    defaultPublicAuditMaxRequestsPerHostname,
  );
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
      ...(scanMode === "public_audit"
        ? { maxRequests, maxRequestsPerHostname }
        : {}),
      allowOptions: scanMode !== "public_audit",
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
      userAgent: browserUserAgent(),
    });
    context.setDefaultNavigationTimeout(navigationTimeoutMs);
    context.setDefaultTimeout(navigationTimeoutMs);

    let openedPageCount = 0;
    let requestCount = 0;
    let blockedRequestCount = 0;
    let requestBudgetExhausted = false;
    const requestCountByHostname = new Map<string, number>();

    const consumeBrowserRequest = (rawUrl: string): boolean => {
      if (scanMode !== "public_audit") {
        return true;
      }
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return false;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return true;
      }
      const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
      const nextTotal = requestCount + 1;
      const nextForHostname = (requestCountByHostname.get(hostname) ?? 0) + 1;
      if (nextTotal > maxRequests || nextForHostname > maxRequestsPerHostname) {
        blockedRequestCount += 1;
        requestBudgetExhausted = true;
        return false;
      }
      requestCount = nextTotal;
      requestCountByHostname.set(hostname, nextForHostname);
      return true;
    };

    context.on("page", (openedPage) => {
      openedPageCount += 1;
      openedPage.on("download", (download) => {
        void download.cancel().catch(() => undefined);
      });
      if (openedPageCount > maxPages) {
        void openedPage.close().catch(() => undefined);
      }
    });

    await context.route("**/*", async (route) => {
      const request = route.request();
      if (!isAllowedBrowserRequest(request.url(), request.method(), scanMode)) {
        await route.abort("blockedbyclient");
        return;
      }
      if (!consumeBrowserRequest(request.url())) {
        await route.abort("blockedbyclient");
        return;
      }

      let policyAllowed = true;
      if (options.requestPolicy) {
        try {
          policyAllowed = await options.requestPolicy({
            url: request.url(),
            method: request.method(),
            resourceType: request.resourceType(),
            isNavigationRequest: request.isNavigationRequest(),
            redirectedFromUrl: request.redirectedFrom()?.url() ?? null,
          });
        } catch {
          policyAllowed = false;
        }
      }
      if (!policyAllowed) {
        await route.abort("blockedbyclient");
        return;
      }

      await route.continue();
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
      requestBudget: () => ({
        total: requestCount,
        blocked: blockedRequestCount,
        exhausted: requestBudgetExhausted,
        byHostname: Object.fromEntries(requestCountByHostname),
      }),
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
