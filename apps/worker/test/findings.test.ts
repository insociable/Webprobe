import { describe, expect, it } from "vitest";
import { generateHttpProbeFindings } from "../src/findings.js";
import type { HttpProbeResult } from "../src/http-probe.js";

function successfulProbe(
  overrides: Partial<Extract<HttpProbeResult, { ok: true }>> = {},
): Extract<HttpProbeResult, { ok: true }> {
  return {
    ok: true,
    finalUrl: "https://example.com/",
    statusCode: 200,
    durationMs: 120,
    redirects: [],
    headers: {
      "content-security-policy": "default-src 'self'",
      "strict-transport-security": "max-age=31536000",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "geolocation=()",
      "x-frame-options": "DENY",
    },
    securityHeaders: [
      {
        name: "content-security-policy",
        expected: true,
        present: true,
        value: "default-src 'self'",
      },
      {
        name: "x-content-type-options",
        expected: true,
        present: true,
        value: "nosniff",
      },
      {
        name: "referrer-policy",
        expected: true,
        present: true,
        value: "strict-origin-when-cross-origin",
      },
      {
        name: "permissions-policy",
        expected: true,
        present: true,
        value: "geolocation=()",
      },
      {
        name: "x-frame-options",
        expected: true,
        present: true,
        value: "DENY",
      },
      {
        name: "strict-transport-security",
        expected: true,
        present: true,
        value: "max-age=31536000",
      },
    ],
    tls: {
      protocol: "TLSv1.3",
      cipher: "TLS_AES_256_GCM_SHA384",
      validFrom: "Sep 01 00:00:00 2026 GMT",
      validTo: "Dec 31 00:00:00 2026 GMT",
    },
    ...overrides,
  };
}
describe("generateHttpProbeFindings", () => {
  it("returns no finding for a healthy response", () => {
    expect(
      generateHttpProbeFindings(
        successfulProbe(),
        "https://example.com/",
        new Date("2026-09-22T00:00:00Z"),
      ),
    ).toEqual([]);
  });

  it("creates stable findings for missing security headers", () => {
    const probe = successfulProbe({
      securityHeaders: [
        {
          name: "content-security-policy",
          expected: true,
          present: false,
          value: null,
        },
        {
          name: "strict-transport-security",
          expected: true,
          present: false,
          value: null,
        },
      ],
    });

    const findings = generateHttpProbeFindings(
      probe,
      "https://example.com/",
      new Date("2026-09-22T00:00:00Z"),
    );

    expect(findings.map((item) => item.code)).toEqual([
      "security-header.csp.missing",
      "security-header.hsts.missing",
    ]);
    expect(findings[0]?.fingerprint).toHaveLength(64);
    expect(findings[0]?.fingerprint).toBe(
      generateHttpProbeFindings(
        probe,
        "https://example.com/",
        new Date("2026-09-22T00:00:00Z"),
      )[0]?.fingerprint,
    );
  });

  it("reports server errors as high availability findings", () => {
    const findings = generateHttpProbeFindings(
      successfulProbe({ statusCode: 503 }),
      "https://example.com/",
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "availability",
        severity: "high",
        code: "availability.http-5xx",
      }),
    );
  });
  it("classifies TLS connection failures as high severity", () => {
    const probe: HttpProbeResult = {
      ok: false,
      targetUrl: "https://example.com/",
      redirects: [],
      error: {
        kind: "tls",
        code: "CERT_HAS_EXPIRED",
      },
    };

    expect(generateHttpProbeFindings(probe, "https://example.com/")).toEqual([
      expect.objectContaining({
        category: "tls",
        severity: "high",
        code: "tls.connection-failed",
      }),
    ]);
  });

  it("reports certificates close to expiry", () => {
    const findings = generateHttpProbeFindings(
      successfulProbe({
        tls: {
          protocol: "TLSv1.3",
          cipher: "TLS_AES_256_GCM_SHA384",
          validFrom: "Sep 01 00:00:00 2026 GMT",
          validTo: "Oct 01 00:00:00 2026 GMT",
        },
      }),
      "https://example.com/",
      new Date("2026-09-22T00:00:00Z"),
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "tls",
        severity: "high",
        code: "tls.certificate-expiring",
      }),
    );
  });

  it("reports slow HTTP responses and technology disclosure", () => {
    const findings = generateHttpProbeFindings(
      successfulProbe({
        durationMs: 5_500,
        headers: {
          "x-powered-by": "Example Framework",
        },
      }),
      "https://example.com/",
      new Date("2026-09-22T00:00:00Z"),
    );

    expect(findings.map((item) => item.code)).toContain(
      "security-header.x-powered-by.exposed",
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "performance",
        severity: "medium",
        code: "performance.http-response-slow",
      }),
    );
  });
});

describe("finding edge cases", () => {
  it("does not require X-Frame-Options when CSP frame-ancestors is present", () => {
    const probe = successfulProbe({
      headers: {
        "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      },
      securityHeaders: [
        {
          name: "x-frame-options",
          expected: true,
          present: false,
          value: null,
        },
      ],
    });

    const findings = generateHttpProbeFindings(
      probe,
      "https://example.com/",
      new Date("2026-09-22T00:00:00Z"),
    );

    expect(findings.map((item) => item.code)).not.toContain(
      "security-header.x-frame-options.missing",
    );
  });

  it("classifies redirect failures separately from network failures", () => {
    const probe: HttpProbeResult = {
      ok: false,
      targetUrl: "https://example.com/",
      redirects: [],
      error: {
        kind: "redirect",
        code: "TOO_MANY_REDIRECTS",
      },
    };

    expect(generateHttpProbeFindings(probe, "https://example.com/")).toEqual([
      expect.objectContaining({
        category: "availability",
        severity: "medium",
        code: "availability.redirect-error",
      }),
    ]);
  });
});
