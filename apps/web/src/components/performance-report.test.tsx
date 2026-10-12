import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PerformanceReport } from "./performance-report";
import { StandardPerformanceReport } from "./standard-performance-report";
import { scoreDeepAudit } from "../lib/deep-report-metrics";
import { compareScanFindings } from "../lib/scan-comparison";
const fixture = {
  metricVersion: "2.0.0",
  coverage: "limited",
  pageUrl: "https://example.test/?token=secret",
  context: {
    viewport: { width: 390, height: 844 },
    windowEndMs: 600,
    cacheState: "cold",
    network: "Proxy gardé",
    ttfbDefinition: "responseStart − requestStart",
    clsDefinition: "Maximum des fenêtres",
    blockingDefinition: "Pas TBT Lighthouse",
  },
  metrics: {
    ttfbMs: { value: 100 },
    fcpMs: { value: null, reason: "api-unavailable" },
    lcpMs: { value: 300 },
    cls: { value: 0 },
    observedThreadBlockingMs: { value: null },
    inpMs: { value: null },
  },
  reasons: ["blocked-resources"],
  excludedThirdPartyRequests: 1,
  resources: {
    observedCount: 2,
    blockedCount: 1,
    transfer: { knownBytes: null, knownCount: 0, observedCount: 2 },
    heavy: [],
    criticalTimeline: [],
    origins: [],
  },
};
describe("performance report", () => {
  it("shows laboratory context, observed zero, unavailable metrics and partial coverage without a global verdict", () => {
    const html = renderToStaticMarkup(
      <PerformanceReport observation={fixture} />,
    );
    expect(html).toContain("Mesures de laboratoire");
    expect(html).toContain("Non mesuré");
    expect(html).toContain("INP : non mesuré");
    expect(html).toContain("Couverture partielle");
    expect(html).toContain("Poids inconnu");
    expect(html).toContain("0/2 tailles connues");
    expect(html).not.toContain("token=secret");
    expect(html).not.toContain("Core Web Vitals validés");
  });
  it("does not fabricate measurements in historical reports and bounds persisted resources", () => {
    expect(
      renderToStaticMarkup(<StandardPerformanceReport summary={{}} />),
    ).toBe("");
    const html = renderToStaticMarkup(
      <StandardPerformanceReport
        summary={{
          scannerV2: {
            performance: {
              metricVersion: "2.0.0",
              observedPageCount: 20,
              pages: Array(20).fill(fixture),
            },
          },
        }}
      />,
    );
    expect(html).toContain("Détails bornés à 5 pages sur 20");
  });
  it("keeps security scores identical with completed, skipped or unavailable performance", () => {
    const security = [
      {
        checkId: "deep-tls",
        status: "completed",
        evidence: [{ data: { findings: [] } }],
      },
    ];
    const score = scoreDeepAudit(security);
    for (const status of ["completed", "skipped", "failed"])
      expect(
        scoreDeepAudit([
          ...security,
          {
            checkId: "deep-performance",
            checkVersion: "1.0.0",
            status,
            evidence: [{ data: fixture }],
          },
        ]),
      ).toEqual(score);
  });
  it("excludes cross-version performance evolution and preserves comparisons for other findings", () => {
    const current = {
      scannerV2: {
        performance: { metricVersion: "2.0.0" },
        completeness: { performance: { status: "complete" } },
      },
    };
    const previous = {
      scannerV2: {
        performance: {},
        completeness: { performance: { status: "complete" } },
      },
    };
    const f = {
      fingerprint: "p",
      code: "performance.cls.high",
      severity: "high" as const,
      title: "CLS",
      pageUrl: null,
    };
    const comparison = compareScanFindings(
      [f],
      [{ ...f, severity: "medium" }],
      { current, previous },
    );
    expect(comparison.performanceComparable).toBe(false);
    expect(comparison.counts.worsened).toBe(0);
    expect(comparison.changesByFingerprint).toEqual({});
  });
});
