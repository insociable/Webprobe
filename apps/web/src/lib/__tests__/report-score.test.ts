import { describe, expect, it } from "vitest";
import {
  gradeForScore,
  reportScoreCategoryDefinitions,
  scoreReport,
  scoreReportCategory,
} from "../report-score";
import type {
  ReportScoreCategoryDefinition,
  ReportScoreFinding,
} from "../report-score";

const securityHttpDefinition: ReportScoreCategoryDefinition = {
  key: "security-http",
  label: "Sécurité HTTP",
  weight: 25,
};

function completeSummary() {
  return {
    http: {
      ok: true,
      tls: {
        protocol: "TLSv1.3",
        cipher: "TLS_AES_256_GCM_SHA384",
      },
      securityHeaders: [
        { name: "content-security-policy", expected: true, present: true },
        { name: "strict-transport-security", expected: true, present: true },
        { name: "x-content-type-options", expected: true, present: true },
        { name: "referrer-policy", expected: true, present: true },
        { name: "permissions-policy", expected: true, present: true },
        { name: "x-frame-options", expected: true, present: true },
      ] as Array<{
        name: string;
        expected: boolean;
        present: boolean;
        value?: string | null;
      }>,
    },
    scannerV2: {
      completeness: {
        crawl: { status: "complete", linkExtractionFailureCount: 0 },
        network: { status: "complete", captureFailureCount: 0 },
        performance: {
          status: "complete",
          observedPageCount: 10,
          eligiblePageCount: 10,
          observerInstalled: true,
        },
        seo: {
          status: "complete",
          observedPageCount: 10,
          eligiblePageCount: 10,
        },
      },
    },
  };
}

function finding(
  input: Partial<ReportScoreFinding> &
    Pick<ReportScoreFinding, "category" | "severity" | "code">,
): ReportScoreFinding {
  return {
    pageUrl: "https://example.test/",
    ...input,
  };
}

describe("Report V2 scoring", () => {
  it("maps numerical scores to stable grades", () => {
    expect(gradeForScore(100)).toBe("A");
    expect(gradeForScore(90)).toBe("A");
    expect(gradeForScore(89)).toBe("B");
    expect(gradeForScore(80)).toBe("B");
    expect(gradeForScore(79)).toBe("C");
    expect(gradeForScore(70)).toBe("C");
    expect(gradeForScore(69)).toBe("D");
    expect(gradeForScore(60)).toBe("D");
    expect(gradeForScore(59)).toBe("E");
    expect(gradeForScore(0)).toBe("E");
    expect(gradeForScore(null)).toBeNull();
  });

  it("keeps category weights explicit and normalized to 100", () => {
    expect(
      reportScoreCategoryDefinitions.reduce(
        (total, category) => total + category.weight,
        0,
      ),
    ).toBe(100);
  });

  it("scores a fully evaluated report without findings at 100/A", () => {
    const result = scoreReport({
      summary: completeSummary(),
      findings: [],
    });

    expect(result).toMatchObject({
      score: 100,
      rawScore: 100,
      grade: "A",
      coverage: "complete",
      coverageCap: 100,
      evaluatedWeight: 100,
    });
    expect(result.categories.every((category) => category.score === 100)).toBe(
      true,
    );
  });

  it("applies severity penalties deterministically", () => {
    const low = scoreReportCategory({
      definition: securityHttpDefinition,
      coverage: { status: "complete" },
      findings: [
        finding({
          category: "security-header",
          severity: "low",
          code: "security-header.referrer-policy.missing",
        }),
      ],
    });
    const medium = scoreReportCategory({
      definition: securityHttpDefinition,
      coverage: { status: "complete" },
      findings: [
        finding({
          category: "security-header",
          severity: "medium",
          code: "security-header.csp.missing",
        }),
      ],
    });
    const high = scoreReportCategory({
      definition: securityHttpDefinition,
      coverage: { status: "complete" },
      findings: [
        finding({
          category: "security-header",
          severity: "high",
          code: "security-header.example.high",
        }),
      ],
    });
    const critical = scoreReportCategory({
      definition: securityHttpDefinition,
      coverage: { status: "complete" },
      findings: [
        finding({
          category: "security-header",
          severity: "critical",
          code: "security-header.example.critical",
        }),
      ],
    });

    expect(low.score).toBe(96);
    expect(medium.score).toBe(88);
    expect(high.score).toBe(76);
    expect(critical.score).toBe(60);
  });

  it("penalizes an observed permissive CSP without inventing a missing-header finding", () => {
    const summary = completeSummary();
    summary.http.securityHeaders[0] = {
      name: "content-security-policy",
      expected: true,
      present: true,
      value:
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    };

    const result = scoreReport({ summary, findings: [] });
    const security = result.categories.find(
      (category) => category.key === "security-http",
    );

    expect(security).toMatchObject({
      score: 92,
      rawScore: 92,
      grade: "A",
      penalty: 8,
      findingCount: 0,
    });
    expect(result.score).toBe(98);
  });

  it("gives a missing CSP a visible but non-catastrophic penalty", () => {
    const result = scoreReport({
      summary: completeSummary(),
      findings: [
        finding({
          category: "security-header",
          severity: "medium",
          code: "security-header.csp.missing",
        }),
      ],
    });

    const security = result.categories.find(
      (category) => category.key === "security-http",
    );
    expect(security).toMatchObject({
      score: 88,
      rawScore: 88,
      grade: "B",
      penalty: 12,
      findingCount: 1,
      distinctFindingCount: 1,
    });
  });

  it("caps repeated occurrences so a shared defect is not counted as many independent issues", () => {
    const repeated = Array.from({ length: 20 }, (_, index) =>
      finding({
        category: "accessibility",
        severity: "low",
        code: "accessibility.region",
        pageUrl: "https://example.test/page-" + index,
      }),
    );

    const result = scoreReportCategory({
      definition: {
        key: "accessibility",
        label: "Accessibilité",
        weight: 15,
      },
      coverage: { status: "complete" },
      findings: repeated,
    });

    expect(result).toMatchObject({
      rawScore: 93,
      score: 93,
      penalty: 7,
      findingCount: 20,
      distinctFindingCount: 1,
    });
  });

  it("caps a partial category according to real observed/eligible coverage", () => {
    const summary = completeSummary();
    summary.scannerV2.completeness.performance = {
      status: "partial",
      observedPageCount: 5,
      eligiblePageCount: 10,
      observerInstalled: true,
    };

    const result = scoreReport({ summary, findings: [] });
    const performance = result.categories.find(
      (category) => category.key === "performance",
    );

    expect(performance).toMatchObject({
      rawScore: 100,
      score: 80,
      grade: "B",
      coverageCap: 80,
      coverage: {
        status: "partial",
        observedCount: 5,
        eligibleCount: 10,
      },
    });
    expect(result.grade).not.toBe("A");
    expect(result.coverage).toBe("partial");
  });

  it("does not turn an unavailable analyzer into a perfect category", () => {
    const summary = completeSummary();
    summary.scannerV2.completeness.seo = {
      status: "unavailable",
      observedPageCount: 0,
      eligiblePageCount: 10,
    };

    const result = scoreReport({ summary, findings: [] });
    const seo = result.categories.find((category) => category.key === "seo");

    expect(seo).toMatchObject({
      score: null,
      rawScore: null,
      grade: null,
      coverageCap: null,
      coverage: { status: "unavailable" },
    });
    expect(result.evaluatedWeight).toBe(85);
    expect(result.score).toBe(89);
    expect(result.grade).toBe("B");
  });

  it("keeps an observed finding visible when completeness metadata is unavailable", () => {
    const result = scoreReport({
      summary: {},
      findings: [
        finding({
          category: "tls",
          severity: "high",
          code: "tls.connection-failed",
        }),
      ],
    });
    const webSecurity = result.categories.find(
      (category) => category.key === "security-web",
    );

    expect(webSecurity).toMatchObject({
      score: 76,
      rawScore: 76,
      coverage: {
        status: "partial",
        reason: "observed-findings-with-incomplete-coverage",
      },
    });
  });

  it("returns no global score when nothing was actually evaluated", () => {
    const result = scoreReport({ summary: {}, findings: [] });

    expect(result).toMatchObject({
      score: null,
      rawScore: null,
      grade: null,
      coverage: "unavailable",
      coverageCap: null,
      evaluatedWeight: 0,
    });
    expect(result.categories.every((category) => category.score === null)).toBe(
      true,
    );
  });

  it("does not consider an empty security header list evaluated", () => {
    const summary = completeSummary();
    summary.http.securityHeaders = [];

    const result = scoreReport({ summary, findings: [] });
    const security = result.categories.find(
      (category) => category.key === "security-http",
    );

    expect(security?.score).toBeNull();
    expect(security?.coverage.status).toBe("unavailable");
    expect(result.grade).not.toBe("A");
  });

  it("keeps public-audit partial coverage from earning an artificial A", () => {
    const summary = completeSummary();
    summary.scannerV2.completeness.crawl = {
      status: "partial",
      linkExtractionFailureCount: 0,
    };
    summary.scannerV2.completeness.network = {
      status: "partial",
      captureFailureCount: 0,
    };
    summary.scannerV2.completeness.performance = {
      status: "partial",
      observedPageCount: 4,
      eligiblePageCount: 10,
      observerInstalled: true,
    };

    const result = scoreReport({ summary, findings: [] });

    expect(result.coverage).toBe("partial");
    expect(result.coverageCap).toBe(89);
    expect(result.score).toBeLessThanOrEqual(89);
    expect(result.grade).toBe("B");
  });
});
