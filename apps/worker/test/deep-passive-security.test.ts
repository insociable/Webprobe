import { describe, expect, it } from "vitest";
import type { HttpProbeResult, ProbeCookie } from "../src/http-probe.js";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { createDeepCheckRegistry } from "../src/scan-engine/deep-checks.js";
import { runChecks } from "../src/scan-engine/engine.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

const pageUrl = "https://sub.example.com/";
const base: Extract<HttpProbeResult, { ok: true }> = {
  ok: true,
  finalUrl: pageUrl,
  statusCode: 200,
  durationMs: 1,
  redirects: [],
  headers: {},
  securityHeaders: [],
  tls: null,
  cookies: [],
};

async function analyze(http: HttpProbeResult) {
  const profile = {
    ...resolveScanProfile("verified_deep_audit"),
    allowedChecks: ["deep-security-headers", "deep-csp", "deep-cookies"],
  };
  const runs = await runChecks({
    profile,
    registry: createDeepCheckRegistry(),
    ledger: new BudgetLedger(profile.budget, Date.now()),
    scope: new ScopeGuard(pageUrl),
    authorization: { allowed: true, level: "deep" },
    targetUrl: pageUrl,
    observations: { http },
  });
  const result = (id: string) => runs.find((run) => run.checkId === id)!;
  const codes = (id: string) =>
    (
      (result(id).evidence[0]?.data.findings ?? []) as Array<{ code: string }>
    ).map((item) => item.code);
  return { result, codes };
}

function cookie(name: string, extra: Partial<ProbeCookie> = {}): ProbeCookie {
  return {
    name,
    secure: true,
    httpOnly: false,
    sameSite: null,
    domain: null,
    path: "/",
    maxAge: null,
    expires: null,
    ...extra,
  };
}

describe("passive Deep security precision", () => {
  it("treats nonce plus strict-dynamic as effective and keeps report-only separate", async () => {
    const csp =
      "script-src 'nonce-redacted' 'strict-dynamic' 'unsafe-inline' * data: http:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
    const { result, codes } = await analyze({
      ...base,
      headers: {
        "content-security-policy": csp,
        "content-security-policy-report-only": "default-src *",
      },
      cspPolicies: {
        enforced: [csp],
        reportOnly: ["default-src *"],
        limited: false,
      },
    });
    expect(codes("deep-csp")).not.toContain("csp-script-unsafe-inline");
    expect(codes("deep-csp")).not.toContain("csp-script-wildcard-source");
    expect(codes("deep-csp")).not.toContain("csp-script-data-source");
    expect(codes("deep-csp")).not.toContain("csp-script-http-source");
    expect(codes("deep-csp")).not.toContain("csp-default-src-absent");
    expect(codes("deep-security-headers")).not.toContain(
      "framing-protection-review",
    );
    expect(result("deep-csp").evidence[0]?.data).toMatchObject({
      applied: true,
      reportOnly: true,
      strictDynamicWithNonceOrHash: true,
      policyCount: 1,
      reportOnlyPolicyCount: 1,
    });
    const reportOnly = await analyze({
      ...base,
      headers: { "content-security-policy-report-only": csp },
      cspPolicies: { enforced: [], reportOnly: [csp], limited: false },
    });
    expect(reportOnly.codes("deep-csp")).toContain("csp-absent");
    expect(reportOnly.result("deep-csp").evidence[0]?.data).toMatchObject({
      applied: false,
      reportOnly: true,
    });
  });

  it("intersects policies, honors first duplicate directive and script fallbacks", async () => {
    const first =
      "script-src 'unsafe-inline' *; script-src 'none'; object-src 'none'; base-uri 'self'";
    const second =
      "script-src-elem 'nonce-redacted'; script-src-attr 'none'; object-src 'none'; base-uri 'self'";
    const { codes, result } = await analyze({
      ...base,
      headers: { "content-security-policy": first },
      cspPolicies: {
        enforced: [first, second],
        reportOnly: [],
        limited: false,
      },
    });
    expect(result("deep-csp").evidence[0]?.data).toMatchObject({
      policyCount: 2,
    });
    expect(codes("deep-csp")).not.toContain("csp-script-unsafe-inline");
    expect(codes("deep-csp")).not.toContain("csp-script-wildcard-source");
    const fallback = await analyze({
      ...base,
      headers: {
        "content-security-policy":
          "default-src 'self'; script-src-attr 'unsafe-inline'",
      },
    });
    expect(fallback.codes("deep-csp")).toContain("csp-script-unsafe-inline");
  });

  it("marks limited CSP evidence without inferring an absent policy", async () => {
    const { result, codes } = await analyze({
      ...base,
      headers: { "content-security-policy": "default-src 'self'" },
      cspPolicies: {
        enforced: ["default-src 'self'"],
        reportOnly: [],
        limited: true,
      },
    });
    expect(codes("deep-csp")).toContain("csp-policy-limited");
    expect(codes("deep-csp")).not.toContain("csp-absent");
    expect(result("deep-csp").evidence[0]?.data).toMatchObject({
      coverage: "limited",
    });
  });

  it("uses the effective referrer value and contextual framing and isolation evidence", async () => {
    const protectedPage = await analyze({
      ...base,
      headers: {
        "content-security-policy": "frame-ancestors 'none'",
        "referrer-policy": "unsafe-url, strict-origin-when-cross-origin",
        "strict-transport-security": "max-age=31536000",
        "x-content-type-options": "nosniff",
      },
    });
    expect(protectedPage.codes("deep-security-headers")).not.toContain(
      "referrer-policy-unsafe-url",
    );
    expect(protectedPage.codes("deep-security-headers")).not.toContain(
      "framing-protection-review",
    );
    expect(protectedPage.codes("deep-security-headers")).not.toContain(
      "cross-origin-embedder-policy-invalid",
    );
    expect(protectedPage.codes("deep-security-headers")).not.toContain(
      "clear-site-data-invalid",
    );
    const permissive = await analyze({
      ...base,
      headers: {
        "content-security-policy": "frame-ancestors *",
        "x-frame-options": "DENY",
        "referrer-policy": "strict-origin, unknown, unsafe-url",
        "permissions-policy": "geolocation=(*), camera=(self)",
        "strict-transport-security": "max-age=0",
        "x-content-type-options": "invalid, nosniff",
        "cross-origin-embedder-policy": "invalid",
      },
    });
    expect(permissive.codes("deep-security-headers")).toEqual(
      expect.arrayContaining([
        "framing-protection-review",
        "referrer-policy-unsafe-url",
        "permissions-policy-wildcard",
        "hsts-weak",
        "nosniff-invalid",
        "cross-origin-embedder-policy-invalid",
      ]),
    );
    const permissions = (
      permissive.result("deep-security-headers").evidence[0]?.data
        .findings as Array<{ code: string; observed?: string }>
    ).find((finding) => finding.code === "permissions-policy-wildcard");
    expect(permissions?.observed).toBe("geolocation");
  });

  it("does not assert that a JS-readable CSRF cookie is a session", async () => {
    const { codes, result } = await analyze({
      ...base,
      cookies: [
        cookie("csrf_token"),
        cookie("prefs"),
        cookie("__Host-session", { path: "/admin" }),
        cookie("external", { secure: false, sameSite: "None" }),
        cookie("long_lived", { maxAge: String(401 * 86_400) }),
        cookie("parent", { domain: "example.com" }),
      ],
    });
    expect(codes("deep-cookies")).not.toContain(
      "sensitive-cookie-without-httponly",
    );
    expect(codes("deep-cookies")).not.toContain(
      "sensitive-cookie-without-samesite",
    );
    expect(codes("deep-cookies")).toEqual(
      expect.arrayContaining([
        "host-prefix-invalid",
        "samesite-none-without-secure",
        "cookie-long-duration",
        "cookie-broad-domain",
      ]),
    );
    expect(JSON.stringify(result("deep-cookies"))).not.toContain(
      "cookie=value",
    );
  });

  it("reports HTTP failure as unavailable instead of missing headers", async () => {
    const { result, codes } = await analyze({
      ok: false,
      targetUrl: pageUrl,
      redirects: [],
      error: { kind: "timeout", code: "ETIMEDOUT" },
    });
    expect(codes("deep-security-headers")).toEqual([]);
    expect(codes("deep-csp")).toEqual([]);
    expect(codes("deep-cookies")).toEqual([]);
    for (const id of ["deep-security-headers", "deep-csp", "deep-cookies"]) {
      expect(result(id).evidence[0]?.data).toMatchObject({
        httpObserved: false,
        coverage: "unavailable",
      });
    }
  });
});

describe("passive rule counterexamples", () => {
  const protectedCsp =
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
  it("distinguishes malformed nonce/hash sources and strict-dynamic behavior", async () => {
    for (const source of ["'nonce-!!!'", "'sha256-!!!'"]) {
      const report = await analyze({
        ...base,
        headers: {
          "content-security-policy":
            "script-src 'unsafe-inline' " + source + "; " + protectedCsp,
        },
      });
      expect(report.codes("deep-csp")).toContain("csp-script-unsafe-inline");
    }
    const strict = await analyze({
      ...base,
      headers: {
        "content-security-policy":
          "script-src 'UNSAFE-INLINE' 'STRICT-DYNAMIC' *; " + protectedCsp,
      },
    });
    expect(strict.codes("deep-csp")).not.toContain("csp-script-unsafe-inline");
    expect(strict.codes("deep-csp")).not.toContain(
      "csp-script-wildcard-source",
    );
  });

  it("intersects comma-separated policies from a single field", async () => {
    const report = await analyze({
      ...base,
      headers: {
        "content-security-policy":
          "script-src 'unsafe-inline' *, script-src 'none'; " + protectedCsp,
      },
    });
    expect(report.result("deep-csp").evidence[0]?.data).toMatchObject({
      policyCount: 2,
      coverage: "observed",
    });
    expect(report.codes("deep-csp")).not.toContain("csp-script-unsafe-inline");
    expect(report.codes("deep-csp")).not.toContain(
      "csp-script-wildcard-source",
    );
  });

  it("handles empty frame lists and ignores none when combined with other sources", async () => {
    const protectedPage = await analyze({
      ...base,
      headers: {
        "content-security-policy":
          "frame-ancestors; object-src 'none'; base-uri 'none'",
      },
    });
    expect(protectedPage.codes("deep-security-headers")).not.toContain(
      "framing-protection-review",
    );
    const permissive = await analyze({
      ...base,
      headers: {
        "content-security-policy":
          "script-src 'self'; object-src 'none' *; base-uri *; form-action https:",
      },
    });
    expect(permissive.codes("deep-csp")).toEqual(
      expect.arrayContaining([
        "csp-object-src-permissive",
        "csp-base-uri-permissive",
        "csp-form-action-permissive",
      ]),
    );
  });

  it("accepts quoted HSTS, repeated nosniff and isolation reporting parameters", async () => {
    const report = await analyze({
      ...base,
      headers: {
        "strict-transport-security": 'max-age="31536000"; includeSubDomains',
        "x-content-type-options": "nosniff, nosniff",
        "cross-origin-opener-policy": 'same-origin; report-to="coop"',
        "cross-origin-embedder-policy": 'require-corp; report-to="coep"',
        "clear-site-data": '"prefetchCache", "prerenderCache"',
        "content-security-policy": "script-src 'self'; " + protectedCsp,
      },
    });
    expect(report.codes("deep-security-headers")).toEqual([]);
  });

  it("marks saturated cookie observations as limited and does not parse scientific Max-Age", async () => {
    const report = await analyze({
      ...base,
      cookies: Array.from({ length: 40 }, (_, i) =>
        cookie("prefs" + i, { maxAge: "1e10" }),
      ),
    });
    expect(report.result("deep-cookies").evidence[0]?.data).toMatchObject({
      coverage: "limited",
    });
    expect(report.codes("deep-cookies")).not.toContain("cookie-long-duration");
  });
});
