import { describe, expect, it } from "vitest";
import type { BrowserRuntimeObservation } from "../src/browser-runtime.js";
import type { HttpProbeResult } from "../src/http-probe.js";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { parseCsp } from "../src/scan-engine/deep-catalog.js";
import { createDeepCheckRegistry } from "../src/scan-engine/deep-checks.js";
import { runChecks } from "../src/scan-engine/engine.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

const catalogIds = [
  "deep-tls",
  "deep-security-headers",
  "deep-csp",
  "deep-cookies",
  "deep-resources",
  "deep-endpoints",
  "deep-forms",
  "deep-browser-meta",
];

async function catalogRuns(
  http: HttpProbeResult,
  browser: BrowserRuntimeObservation,
) {
  const profile = {
    ...resolveScanProfile("verified_deep_audit"),
    allowedChecks: catalogIds,
  };
  return runChecks({
    profile,
    registry: createDeepCheckRegistry(),
    ledger: new BudgetLedger(profile.budget, Date.now()),
    scope: new ScopeGuard("https://example.com/"),
    authorization: { allowed: true, level: "deep" },
    targetUrl: "https://example.com/",
    observations: { http, browser },
  });
}

describe("deep catalog", () => {
  it("parses CSP directives once without inheriting object prototype keys", () => {
    expect(
      parseCsp(
        "DEFAULT-src 'self'; script-src 'unsafe-inline' *; script-src https:; toString x",
      ),
    ).toMatchObject({
      "default-src": ["'self'"],
      "script-src": ["'unsafe-inline'", "*"],
      tostring: ["x"],
    });
  });

  it("emits structured, passive evidence for every catalog check", async () => {
    const http: HttpProbeResult = {
      ok: true,
      finalUrl: "https://example.com/",
      statusCode: 200,
      durationMs: 10,
      redirects: [
        {
          from: "http://example.com/",
          to: "https://example.com/",
          statusCode: 301,
        },
      ],
      headers: {
        "strict-transport-security": "max-age=100",
        "x-content-type-options": "invalid",
        "referrer-policy": "unsafe-url",
        "content-security-policy":
          "script-src 'unsafe-inline' * data: http:; object-src *",
        "content-security-policy-report-only": "default-src 'self'",
      },
      securityHeaders: [],
      tls: {
        protocol: "TLSv1.1",
        cipher: "TEST",
        validFrom: "Jan 1 2025",
        validTo: "Jan 1 2020",
        certificate: {
          subjectCn: "example.com",
          subjectAltNames: ["DNS:example.com"],
          issuerCn: "CA",
          fingerprint256: "fingerprint",
          signatureAlgorithm: null,
          keyType: "rsa",
          keyBits: 2048,
          hostnameMatch: false,
          authorized: false,
          authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID",
          chain: [],
        },
      },
      cookies: [
        {
          name: "session",
          secure: false,
          httpOnly: false,
          sameSite: "None",
          domain: null,
          path: "/",
          maxAge: null,
          expires: null,
        },
      ],
    };
    const browser: BrowserRuntimeObservation = {
      finalUrl: "https://example.com/",
      statusCode: 200,
      pageCount: 1,
      durationMs: 20,
      deep: {
        resources: [
          {
            url: "http://example.com/app.js",
            type: "script",
            inScope: true,
            blocked: true,
            statusCode: null,
            method: "GET",
          },
        ],
        endpoints: [
          {
            url: "https://example.com/api",
            source: "browser-request",
            method: "GET",
            inScope: true,
            statusCode: 200,
          },
        ],
        forms: [
          {
            action: "http://example.com/login",
            method: "POST",
            inScope: true,
            passwordFields: 1,
            sensitiveFields: 1,
            csrfHint: false,
            autocomplete: null,
            enctype: null,
          },
        ],
        meta: [{ name: "referrer", content: "strict-origin" }],
        iframeSandboxes: [],
        sri: [],
        pageErrors: ["TypeError"],
        consoleWarnings: ["Mixed Content"],
        excludedThirdPartyRequests: 1,
      },
    };
    const runs = await catalogRuns(http, browser);
    expect(runs.filter((run) => catalogIds.includes(run.checkId))).toHaveLength(
      8,
    );
    for (const id of catalogIds) {
      const run = runs.find((item) => item.checkId === id);
      expect(run).toMatchObject({
        status: "completed",
        evidence: [{ classification: "observation" }],
      });
      expect(run?.evidence[0]?.data).toMatchObject({
        title: expect.any(String),
        summary: expect.any(String),
        status: expect.any(String),
        findings: expect.any(Array),
      });
    }
    const codes = (id: string) =>
      (
        runs.find((item) => item.checkId === id)?.evidence[0]?.data
          .findings as Array<{ code: string }>
      ).map((item) => item.code);
    expect(codes("deep-tls")).toEqual(
      expect.arrayContaining([
        "legacy-tls-protocol",
        "certificate-expired",
        "certificate-validation-error",
      ]),
    );
    expect(codes("deep-security-headers")).toEqual(
      expect.arrayContaining([
        "hsts-weak",
        "nosniff-invalid",
        "referrer-policy-unsafe-url",
      ]),
    );
    expect(codes("deep-csp")).toEqual(
      expect.arrayContaining([
        "csp-script-unsafe-inline",
        "csp-script-wildcard-source",
        "csp-default-src-absent",
      ]),
    );
    expect(codes("deep-cookies")).toEqual(
      expect.arrayContaining([
        "sensitive-cookie-without-secure",
        "samesite-none-without-secure",
      ]),
    );
    expect(codes("deep-resources")).toContain("mixed-content-resource");
    expect(codes("deep-forms")).toContain("form-post-over-http");
    expect(JSON.stringify(runs)).not.toContain("secret=value");
  });

  it("records a certificate handshake error as an observation", async () => {
    const profile = {
      ...resolveScanProfile("verified_deep_audit"),
      allowedChecks: ["deep-tls"],
    };
    const runs = await runChecks({
      profile,
      registry: createDeepCheckRegistry(),
      ledger: new BudgetLedger(profile.budget, Date.now()),
      scope: new ScopeGuard("https://example.com/"),
      authorization: { allowed: true, level: "deep" },
      targetUrl: "https://example.com/",
      observations: {
        http: {
          ok: false,
          targetUrl: "https://example.com/",
          redirects: [],
          error: { kind: "tls", code: "CERT_HAS_EXPIRED" },
        } satisfies HttpProbeResult,
      },
    });
    expect(runs.find((run) => run.checkId === "deep-tls")).toMatchObject({
      status: "completed",
      evidence: [
        {
          data: {
            errorKind: "tls",
            findings: [
              {
                code: "tls-or-http-connection-error",
                observed: "CERT_HAS_EXPIRED",
              },
            ],
          },
        },
      ],
    });
  });
});
