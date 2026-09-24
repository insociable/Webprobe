import type { DnsResolver } from "@agency-saas/security";
import type { Browser, LaunchOptions } from "playwright";
import {
  createIsolatedBrowserSession,
  type BrowserRuntimeObservation,
  type IsolatedBrowserSession,
} from "../browser-runtime.js";
import type { AuthorizationDecision } from "./authorization.js";
import { BudgetLedger } from "./budget-ledger.js";
import { ScopeGuard } from "./scope-guard.js";
import type { ScanProfile } from "./types.js";

/** Internal candidate transport. Dispatch remains locked until the full pipeline is ready. */
export async function createGuardedBrowserSession(input: {
  profile: ScanProfile;
  authorization: AuthorizationDecision;
  scope: ScopeGuard;
  ledger: BudgetLedger;
  resolver?: DnsResolver;
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
}): Promise<IsolatedBrowserSession> {
  const { authorization, ledger, profile, scope } = input;
  if (
    profile.mode !== "verified_deep_audit" ||
    !authorization.allowed ||
    authorization.level !== "deep"
  ) {
    ledger.markPartial("authorization-unavailable");
    throw new Error("Deep browser authorization unavailable");
  }

  const inScopeAndTime = (rawUrl: string): boolean => {
    if (!scope.allows(rawUrl).allowed) {
      ledger.markPartial("scope-denied");
      return false;
    }
    return ledger.checkNetwork().allowed;
  };
  let pageBudgetExhausted = false;
  if (!ledger.checkNetwork().allowed) {
    throw new Error("Deep browser network budget exhausted");
  }
  const maxLifetimeMs =
    profile.budget.maxDurationMs - ledger.snapshot().elapsedMs;
  if (maxLifetimeMs <= 0) throw new Error("Deep browser time budget exhausted");

  return createIsolatedBrowserSession({
    ...(input.resolver ? { resolver: input.resolver } : {}),
    ...(input.launchBrowser ? { launchBrowser: input.launchBrowser } : {}),
    scanMode: "public_audit",
    navigationTimeoutMs: profile.navigationTimeoutMs,
    maxPages: profile.budget.pages,
    maxRequests: profile.budget.httpRequests,
    maxRequestsPerHostname: profile.budget.maxRequestsPerHostname,
    networkGuard: {
      maxTransferredBytes: profile.budget.bytesTransferred,
      maxLifetimeMs,
      allowPage: () => {
        const allowed = ledger.reserve("pages").allowed;
        if (!allowed) pageBudgetExhausted = true;
        return allowed;
      },
      allowRequest(request) {
        let url: URL;
        try {
          url = new URL(request.url);
        } catch {
          ledger.markPartial("scope-denied");
          return false;
        }
        if (url.protocol === "data:" || url.protocol === "blob:") return true;
        if (
          pageBudgetExhausted ||
          !["http:", "https:"].includes(url.protocol) ||
          !["GET", "HEAD"].includes(request.method.toUpperCase()) ||
          !inScopeAndTime(request.url)
        ) {
          ledger.markPartial("scope-denied");
          return false;
        }
        return ledger.reserve("httpRequests", 1, url.hostname).allowed;
      },
      allowProxyTarget(url) {
        if (!inScopeAndTime(url.toString())) return false;
        return ledger.reserveMany(
          {
            dnsQueries: 1,
            tlsHandshakes: url.protocol === "https:" ? 1 : 0,
          },
          url.hostname,
        ).allowed;
      },
      allowProxyConnection(url) {
        return inScopeAndTime(url.toString());
      },
      accountProxyBytes(bytes) {
        return ledger.reserve("bytesTransferred", bytes).allowed;
      },
    },
  });
}

export async function observeGuardedBrowserTarget(
  input: Parameters<typeof createGuardedBrowserSession>[0] & {
    targetUrl: string;
  },
): Promise<BrowserRuntimeObservation> {
  if (!input.scope.allows(input.targetUrl).allowed) {
    input.ledger.markPartial("scope-denied");
    throw new Error("Browser target outside authorized scope");
  }
  const startedAt = Date.now();
  const session = await createGuardedBrowserSession(input);
  try {
    const page = await session.context.newPage();
    const response = await page.goto(input.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: input.profile.navigationTimeoutMs,
    });
    const finalUrl = page.url();
    if (!input.scope.allows(finalUrl).allowed) {
      input.ledger.markPartial("scope-denied");
      throw new Error("Browser navigated outside authorized scope");
    }
    const safeUrl = new URL(finalUrl);
    safeUrl.search = "";
    safeUrl.hash = "";
    return {
      finalUrl: safeUrl.toString(),
      statusCode: response?.status() ?? null,
      pageCount: session.pageCount(),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await session.close();
  }
}
