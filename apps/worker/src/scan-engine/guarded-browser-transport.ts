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
import { abortable, cancellableDnsResolver, throwIfAborted } from "./abort.js";

/** Internal candidate transport. Dispatch remains locked until the full pipeline is ready. */
export async function createGuardedBrowserSession(input: {
  profile: ScanProfile;
  authorization: AuthorizationDecision;
  scope: ScopeGuard;
  ledger: BudgetLedger;
  resolver?: DnsResolver;
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
  signal?: AbortSignal;
  beforeNetwork?: () => Promise<void>;
}): Promise<IsolatedBrowserSession> {
  throwIfAborted(input.signal);
  const { authorization, ledger, profile, scope } = input;
  if (
    profile.mode !== "verified_deep_audit" ||
    !authorization.allowed ||
    authorization.level !== "deep"
  ) {
    ledger.markPartial("authorization-unavailable");
    throw new Error("Deep browser authorization unavailable");
  }
  if (!input.signal || !input.beforeNetwork)
    throw new Error("Deep browser execution guard unavailable");

  const inScopeAndTime = (rawUrl: string): boolean => {
    if (input.signal?.aborted) return false;
    if (!scope.allows(rawUrl).allowed) {
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
    ...(input.resolver
      ? { resolver: input.resolver }
      : input.signal
        ? { resolver: cancellableDnsResolver(input.signal) }
        : {}),
    ...(input.launchBrowser ? { launchBrowser: input.launchBrowser } : {}),
    scanMode: "public_audit",
    navigationTimeoutMs: profile.navigationTimeoutMs,
    maxPages: profile.budget.pages,
    maxRequests: profile.budget.httpRequests,
    maxRequestsPerHostname: profile.budget.maxRequestsPerHostname,
    networkGuard: {
      ...(input.signal ? { signal: input.signal } : {}),
      maxTransferredBytes: profile.budget.bytesTransferred,
      maxLifetimeMs,
      allowPage: () => {
        if (input.signal?.aborted) return false;
        const allowed = ledger.reserve("pages").allowed;
        if (!allowed) pageBudgetExhausted = true;
        return allowed;
      },
      async allowRequest(request) {
        try {
          await input.beforeNetwork?.();
        } catch {
          return false;
        }
        if (input.signal?.aborted) return false;
        let url: URL;
        try {
          url = new URL(request.url);
        } catch {
          return false;
        }
        if (url.protocol === "data:" || url.protocol === "blob:") return true;
        if (
          pageBudgetExhausted ||
          !["http:", "https:"].includes(url.protocol) ||
          !["GET", "HEAD"].includes(request.method.toUpperCase()) ||
          !inScopeAndTime(request.url)
        ) {
          return false;
        }
        return ledger.reserve("httpRequests", 1, url.hostname).allowed;
      },
      async allowProxyTarget(url) {
        try {
          await input.beforeNetwork?.();
        } catch {
          return false;
        }
        if (input.signal?.aborted) return false;
        if (!inScopeAndTime(url.toString())) return false;
        return ledger.reserveMany(
          {
            dnsQueries: 1,
            tlsHandshakes: url.protocol === "https:" ? 1 : 0,
          },
          url.hostname,
        ).allowed;
      },
      async allowProxyConnection(url) {
        try {
          await input.beforeNetwork?.();
        } catch {
          return false;
        }
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
  throwIfAborted(input.signal);
  if (!input.scope.allows(input.targetUrl).allowed) {
    input.ledger.markPartial("scope-denied");
    throw new Error("Browser target outside authorized scope");
  }
  const startedAt = Date.now();
  const session = await createGuardedBrowserSession(input);
  try {
    const page = await abortable(session.context.newPage(), input.signal);
    const response = await abortable(
      page.goto(input.targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: input.profile.navigationTimeoutMs,
      }),
      input.signal,
    );
    throwIfAborted(input.signal);
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
