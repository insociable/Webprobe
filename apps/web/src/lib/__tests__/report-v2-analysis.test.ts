import { describe, expect, it } from "vitest";
import {
  buildReportRecommendations,
  recommendationLevelForFinding,
} from "../report-recommendations";
import { scoreReport } from "../report-score";
import {
  getSafeReportTechnicalDetails,
  sanitizeReportHeaderValue,
  sanitizeReportUrl,
} from "../report-technical-details";
import { getSecurityHttpControls } from "../security-http-controls";
import { correlateReportSignals } from "../report-correlations";

function completeSummary() {
  return {
    http: {
      ok: true,
      statusCode: 200,
      finalUrl: "https://example.test/path?token=secret#fragment",
      durationMs: 120,
      tls: {
        protocol: "TLSv1.3",
        cipher: "TLS_AES_256_GCM_SHA384",
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2027-01-01T00:00:00.000Z",
      },
      headers: {
        "content-security-policy":
          "default-src 'self'; report-uri https://reports.example.test/csp?token=secret",
        "strict-transport-security": "max-age=31536000",
        "x-content-type-options": "nosniff",
        "set-cookie": "session=top-secret",
        authorization: "Bearer top-secret",
        "x-private-secret": "secret",
      },
      securityHeaders: [
        {
          name: "content-security-policy",
          expected: true,
          present: true,
          value: "default-src 'self'",
        },
        {
          name: "strict-transport-security",
          expected: true,
          present: true,
          value: "max-age=31536000",
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
          value: "camera=()",
        },
        {
          name: "x-frame-options",
          expected: true,
          present: true,
          value: "DENY",
        },
      ] as Array<{
        name: string;
        expected: boolean;
        present: boolean;
        value: string | null;
      }>,
    },
    scannerV2: {
      completeness: {
        crawl: { status: "complete" },
        network: { status: "complete" },
        performance: {
          status: "complete",
          observedPageCount: 4,
          eligiblePageCount: 4,
        },
        seo: {
          status: "complete",
          observedPageCount: 4,
          eligiblePageCount: 4,
        },
      },
    },
  };
}

describe("Report V2 recommendation model", () => {
  it("classifies findings into fix, improve and consider deterministically", () => {
    expect(
      recommendationLevelForFinding({
        category: "security-header",
        severity: "medium",
        code: "security-header.csp.missing",
      }),
    ).toBe("fix");
    expect(
      recommendationLevelForFinding({
        category: "accessibility",
        severity: "medium",
        code: "accessibility.color-contrast",
      }),
    ).toBe("improve");
    expect(
      recommendationLevelForFinding({
        category: "seo",
        severity: "low",
        code: "seo.title.duplicate",
      }),
    ).toBe("improve");
    expect(
      recommendationLevelForFinding({
        category: "seo",
        severity: "info",
        code: "seo.noindex",
      }),
    ).toBe("consider");
  });

  it("deduplicates repeated findings and prioritizes actionable issues", () => {
    const findings = [
      {
        category: "accessibility",
        severity: "low" as const,
        code: "accessibility.region",
        pageUrl: "https://example.test/a",
      },
      {
        category: "accessibility",
        severity: "low" as const,
        code: "accessibility.region",
        pageUrl: "https://example.test/b",
      },
      {
        category: "security-header",
        severity: "medium" as const,
        code: "security-header.csp.missing",
        pageUrl: "https://example.test/",
      },
      {
        category: "seo",
        severity: "info" as const,
        code: "seo.noindex",
        pageUrl: "https://example.test/private",
      },
    ];
    const scorecard = scoreReport({
      summary: completeSummary(),
      findings,
    });
    const result = buildReportRecommendations(findings, scorecard, 3);

    expect(result.groups).toHaveLength(3);
    expect(result.counts).toEqual({ fix: 1, improve: 1, consider: 1 });
    expect(result.priorities[0]?.key).toBe("security-header.csp.missing");
    expect(result.priorities.map((item) => item.level)).not.toContain(
      "consider",
    );
    expect(
      result.groups.find((item) => item.key === "accessibility.region"),
    ).toMatchObject({
      occurrenceCount: 2,
      pageUrls: ["https://example.test/a", "https://example.test/b"],
    });
  });
});

describe("Report V2 safe technical details", () => {
  it("strips credentials, query strings and fragments from displayed URLs", () => {
    expect(
      sanitizeReportUrl(
        "https://user:password@example.test/path?token=secret#fragment",
      ),
    ).toBe("https://example.test/path");
  });

  it("sanitizes embedded URLs inside allowed header values", () => {
    expect(
      sanitizeReportHeaderValue(
        "report-uri https://reports.example.test/csp?token=secret",
      ),
    ).toBe("report-uri https://reports.example.test/csp");
  });

  it("never exposes cookies, authorization or arbitrary headers", () => {
    const details = getSafeReportTechnicalDetails(completeSummary());
    const names = details?.http.headers.map((header) => header.name) ?? [];
    const serialized = JSON.stringify(details);

    expect(names).toContain("content-security-policy");
    expect(names).toContain("strict-transport-security");
    expect(names).not.toContain("set-cookie");
    expect(names).not.toContain("authorization");
    expect(names).not.toContain("x-private-secret");
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("token=secret");
    expect(details?.http.finalUrl).toBe("https://example.test/path");
  });
});

describe("Report V2 HTTP security controls", () => {
  it("marks a permissive CSP as a warning without inventing a missing header", () => {
    const summary = completeSummary();
    summary.http.securityHeaders[0] = {
      name: "content-security-policy",
      expected: true,
      present: true,
      value:
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    };

    const controls = getSecurityHttpControls(summary);
    const csp = controls.find(
      (control) => control.name === "content-security-policy",
    );

    expect(csp).toMatchObject({
      status: "warning",
    });
    expect(csp?.notes).toHaveLength(2);
    expect(csp?.notes.join(" ")).toContain("unsafe-inline");
    expect(csp?.notes.join(" ")).toContain("unsafe-eval");
  });

  it("accepts CSP frame-ancestors as anti-framing protection", () => {
    const summary = completeSummary();
    summary.http.securityHeaders[0] = {
      name: "content-security-policy",
      expected: true,
      present: true,
      value: "default-src 'self'; frame-ancestors 'none'",
    };
    summary.http.securityHeaders[5] = {
      name: "x-frame-options",
      expected: true,
      present: false,
      value: null,
    };

    const controls = getSecurityHttpControls(summary);
    const framing = controls.find(
      (control) => control.name === "x-frame-options",
    );

    expect(framing).toMatchObject({ status: "pass" });
    expect(framing?.notes.join(" ")).toContain("frame-ancestors");
  });

  it("marks an actually missing expected header as failed", () => {
    const summary = completeSummary();
    summary.http.securityHeaders[4] = {
      name: "permissions-policy",
      expected: true,
      present: false,
      value: null,
    };

    const controls = getSecurityHttpControls(summary);
    expect(
      controls.find((control) => control.name === "permissions-policy"),
    ).toMatchObject({ status: "fail" });
  });
});

describe("Report V2 correlations", () => {
  it("correlates observed HTTPS with missing HSTS", () => {
    const summary = completeSummary();
    const findings = [
      {
        category: "security-header",
        severity: "medium" as const,
        code: "security-header.hsts.missing",
      },
    ];

    const correlations = correlateReportSignals({ summary, findings });
    expect(correlations).toEqual([
      expect.objectContaining({
        id: "https-without-hsts",
        priority: "medium",
      }),
    ]);
  });

  it("does not invent the HSTS correlation without observed HTTPS", () => {
    const summary = completeSummary();
    summary.http.finalUrl = "http://example.test/";
    summary.http.tls = null;

    const correlations = correlateReportSignals({
      summary,
      findings: [
        {
          category: "security-header",
          severity: "medium",
          code: "security-header.hsts.missing",
        },
      ],
    });

    expect(correlations).toEqual([]);
  });

  it("does not create a correlation when HSTS is not reported missing", () => {
    expect(
      correlateReportSignals({ summary: completeSummary(), findings: [] }),
    ).toEqual([]);
  });
});
