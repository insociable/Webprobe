/// <reference lib="dom" />
import type { DnsResolver } from "@agency-saas/security";
import type { Browser, LaunchOptions } from "playwright";
import { observeCookies, type ProbeCookie } from "../http-probe.js";
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

function safeObservedUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 512);
  } catch {
    return null;
  }
}

function safeMetaContent(name: string, rawContent: string): string {
  if (/^refresh$/i.test(name)) {
    return /^\s*(\d+(?:\.\d+)?)/.exec(rawContent)?.[1] ?? "present";
  }
  return rawContent.slice(0, 512);
}

function safeMetaContent(name: string, rawContent: string): string {
  if (/^refresh$/i.test(name)) {
    return /^\s*(\d+(?:\.\d+)?)/.exec(rawContent)?.[1] ?? "present";
  }
  return rawContent.slice(0, 512);
}

async function boundedDomObservation<T>(
  evaluation: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await abortable(
      Promise.race([
        evaluation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("DOM observation timed out")),
            timeoutMs,
          );
        }),
      ]),
      signal,
    );
  } catch {
    throwIfAborted(signal);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  onExcludedUrl?: (url: string) => void;
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
      // Third-party page resources are excluded from authorized scope; they do
      // not make the first-party assessment globally incomplete.
      input.onExcludedUrl?.(rawUrl);
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
  let excludedThirdPartyRequests = 0;
  const session = await createGuardedBrowserSession({
    ...input,
    onExcludedUrl: (url) => {
      if (!input.scope.allows(url).allowed) excludedThirdPartyRequests += 1;
    },
  });
  try {
    const page = await abortable(session.context.newPage(), input.signal);
    const resources = new Map<
      string,
      NonNullable<BrowserRuntimeObservation["deep"]>["resources"][number]
    >();
    const endpoints = new Map<
      string,
      NonNullable<BrowserRuntimeObservation["deep"]>["endpoints"][number]
    >();
    const pageErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const cookies: ProbeCookie[] = [];
    const cookieTasks: Promise<void>[] = [];
    page.on("request", (request) => {
      const url = safeObservedUrl(request.url());
      if (!url || resources.size >= 120) return;
      const inScope = input.scope.allows(request.url()).allowed;
      resources.set(url, {
        url,
        type: request.resourceType().slice(0, 32),
        inScope,
        blocked: !inScope,
        statusCode: null,
        method: request.method().slice(0, 12).toUpperCase(),
      });
      if (endpoints.size < 120)
        endpoints.set(url, {
          url,
          source: "browser-request",
          method: request.method().slice(0, 12).toUpperCase(),
          inScope,
          statusCode: null,
        });
    });
    page.on("response", (response) => {
      const url = safeObservedUrl(response.url());
      if (!url) return;
      const resource = resources.get(url);
      if (resource) {
        resource.statusCode = response.status();
        const length = Number(response.headers()["content-length"]);
        resource.contentLength =
          Number.isSafeInteger(length) && length >= 0 ? length : null;
      }
      const endpoint = endpoints.get(url);
      if (endpoint) endpoint.statusCode = response.status();
      if (
        input.scope.allows(response.url()).allowed &&
        cookieTasks.length < 120
      ) {
        cookieTasks.push(
          response
            .headersArray()
            .then((headers) => {
              const values = headers
                .filter((item) => item.name.toLowerCase() === "set-cookie")
                .map((item) => item.value);
              cookies.push(
                ...observeCookies({ "set-cookie": values }).slice(
                  0,
                  Math.max(0, 120 - cookies.length),
                ),
              );
            })
            .catch(() => undefined),
        );
      }
    });
    page.on("requestfailed", (request) => {
      const url = safeObservedUrl(request.url());
      const resource = url ? resources.get(url) : undefined;
      if (resource) resource.blocked = true;
    });
    page.on("pageerror", (error) => {
      if (pageErrors.length < 20) pageErrors.push(error.name.slice(0, 80));
    });
    page.on("console", (message) => {
      if (
        !["warning", "error"].includes(message.type()) ||
        consoleWarnings.length >= 20
      )
        return;
      const text = message.text();
      const category = /content security|csp/i.test(text)
        ? "content-security-policy"
        : /mixed content/i.test(text)
          ? "mixed-content"
          : /cors/i.test(text)
            ? "cors"
            : /certificate/i.test(text)
              ? "certificate"
              : null;
      if (category) consoleWarnings.push(category);
    });
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
    await boundedDomObservation(
      Promise.all(cookieTasks),
      input.signal,
      Math.max(1, Math.min(2_000, input.ledger.remainingDurationMs())),
    );
    const dom =
      typeof page.evaluate === "function"
        ? await boundedDomObservation(
            page.evaluate(() => {
              const absolute = (raw: string) => {
                try {
                  return new URL(raw, document.baseURI).toString();
                } catch {
                  return "";
                }
              };
              const resources = Array.from(
                document.querySelectorAll(
                  "script[src],link[href],img[src],iframe[src],source[src]",
                ),
              )
                .slice(0, 120)
                .map((element) => ({
                  url: absolute(
                    element.getAttribute("src") ??
                      element.getAttribute("href") ??
                      "",
                  ),
                  type: element.tagName.toLowerCase(),
                }));
              const links = Array.from(document.querySelectorAll("a[href]"))
                .slice(0, 100)
                .map((element) => absolute(element.getAttribute("href") ?? ""));
              const forms = Array.from(document.forms)
                .slice(0, 40)
                .map((form) => ({
                  action: absolute(form.getAttribute("action") || document.URL),
                  method: (form.getAttribute("method") || "GET").toUpperCase(),
                  passwordFields: form.querySelectorAll(
                    'input[type="password"]',
                  ).length,
                  sensitiveFields: form.querySelectorAll(
                    'input[type="password"],input[autocomplete="cc-number"],input[autocomplete="current-password"]',
                  ).length,
                  csrfHint: Array.from(
                    form.querySelectorAll("input[name]"),
                  ).some((field) =>
                    /csrf|xsrf|authenticity/i.test(
                      field.getAttribute("name") ?? "",
                    ),
                  ),
                  autocomplete: form.getAttribute("autocomplete"),
                  enctype: form.getAttribute("enctype"),
                }));
              const meta = Array.from(
                document.querySelectorAll("meta[http-equiv],meta[name]"),
              )
                .filter((element) =>
                  /^(content-security-policy|refresh|referrer|permissions-policy|x-frame-options|strict-transport-security)$/i.test(
                    element.getAttribute("http-equiv") ??
                      element.getAttribute("name") ??
                      "",
                  ),
                )
                .slice(0, 30)
                .map((element) => ({
                  name: (
                    element.getAttribute("http-equiv") ??
                    element.getAttribute("name") ??
                    ""
                  ).slice(0, 80),
                  content: (element.getAttribute("content") ?? "").slice(
                    0,
                    512,
                  ),
                }));
              const iframeSandboxes = Array.from(
                document.querySelectorAll("iframe"),
              )
                .slice(0, 30)
                .map((element) => ({
                  url: absolute(element.getAttribute("src") ?? ""),
                  sandbox: element.getAttribute("sandbox"),
                }));
              const sri = Array.from(
                document.querySelectorAll(
                  'script[src],link[rel~="stylesheet"][href]',
                ),
              )
                .slice(0, 80)
                .map((element) => ({
                  url: absolute(
                    element.getAttribute("src") ??
                      element.getAttribute("href") ??
                      "",
                  ),
                  integrityPresent: element.hasAttribute("integrity"),
                  crossorigin: element.getAttribute("crossorigin"),
                }));
              return { resources, links, forms, meta, iframeSandboxes, sri };
            }),
            input.signal,
            Math.max(1, Math.min(2_000, input.ledger.remainingDurationMs())),
          )
        : null;
    for (const item of dom?.resources ?? []) {
      const url = safeObservedUrl(item.url);
      if (!url || resources.has(url) || resources.size >= 120) continue;
      const inScope = input.scope.allows(item.url).allowed;
      resources.set(url, {
        url,
        type: item.type,
        inScope,
        blocked: !inScope,
        statusCode: null,
        method: null,
      });
      if (!endpoints.has(url) && endpoints.size < 120)
        endpoints.set(url, {
          url,
          source: "html-resource",
          method: "GET",
          inScope,
          statusCode: null,
        });
    }
    for (const raw of dom?.links ?? []) {
      const url = safeObservedUrl(raw);
      if (!url || endpoints.has(url) || endpoints.size >= 120) continue;
      endpoints.set(url, {
        url,
        source: "html-link",
        method: "GET",
        inScope: input.scope.allows(raw).allowed,
        statusCode: null,
      });
    }
    const forms = (dom?.forms ?? []).flatMap((form) => {
      const action = safeObservedUrl(form.action);
      if (!action) return [];
      if (!endpoints.has(action) && endpoints.size < 120)
        endpoints.set(action, {
          url: action,
          source: "form",
          method: form.method,
          inScope: input.scope.allows(form.action).allowed,
          statusCode: null,
        });
      return [
        { ...form, action, inScope: input.scope.allows(form.action).allowed },
      ];
    });
    return {
      finalUrl: safeUrl.toString(),
      statusCode: response?.status() ?? null,
      pageCount: session.pageCount(),
      durationMs: Date.now() - startedAt,
      deep: {
        resources: [...resources.values()],
        endpoints: [...endpoints.values()],
        forms,
        meta: (dom?.meta ?? []).map((item) => ({
          name: item.name,
          content: safeMetaContent(item.name, item.content),
        })),
        iframeSandboxes: (dom?.iframeSandboxes ?? []).flatMap((item) => {
          const url = safeObservedUrl(item.url);
          return url ? [{ url, sandbox: item.sandbox }] : [];
        }),
        sri: (dom?.sri ?? []).flatMap((item) => {
          const url = safeObservedUrl(item.url);
          return url
            ? [
                {
                  url,
                  integrityPresent: item.integrityPresent,
                  crossorigin: item.crossorigin,
                },
              ]
            : [];
        }),
        pageErrors,
        consoleWarnings,
        excludedThirdPartyRequests,
        cookies: cookies.slice(0, 120),
      },
    };
  } finally {
    await session.close();
  }
}
