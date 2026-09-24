import { describe, expect, it } from "vitest";
import {
  deepFindings,
  observedPageCount,
  scoreDeepAudit,
  type DeepRunData,
} from "../deep-report-metrics";

const diagnosticIds = [
  "deep-tls",
  "deep-csp",
  "deep-security-headers",
  "deep-cookies",
  "deep-forms",
  "deep-resources",
  "deep-browser-meta",
  "deep-endpoints",
];

function run(
  checkId: string,
  findings: Array<Record<string, unknown>> = [],
  extra: Record<string, unknown> = {},
  status = "completed",
): DeepRunData {
  return {
    checkId,
    status,
    evidence: [{ data: { findings, ...extra } }],
  };
}

function completeRuns(): DeepRunData[] {
  return diagnosticIds.map((id) =>
    run(id, [], id === "deep-csp" ? { applied: true } : {}),
  );
}

describe("Deep report metrics", () => {
  it("uses the completed browser observation, including a genuine zero", () => {
    expect(
      observedPageCount("verified_deep_audit", 0, [
        run("deep-browser-observation", [], { pageCount: 1 }),
      ]),
    ).toBe(1);
    expect(
      observedPageCount("verified_deep_audit", 3, [
        run("deep-browser-observation", [], { pageCount: 0 }),
      ]),
    ).toBe(0);
    expect(
      observedPageCount("verified_deep_audit", 3, [
        run("deep-browser-observation", [], { pageCount: -1 }),
      ]),
    ).toBeNull();
    expect(
      observedPageCount("verified_deep_audit", 3, [
        run("deep-browser-observation", [], { pageCount: 1 }, "failed"),
      ]),
    ).toBeNull();
    expect(
      observedPageCount("public_audit", 3, [
        run("deep-browser-observation", [], { pageCount: 1 }),
      ]),
    ).toBe(3);
  });

  it("shows the CSP recommendation once for historical reports", () => {
    const csp = run("deep-csp", [], { applied: false, reportOnly: false });
    const headers = run("deep-security-headers", [
      { code: "csp-absent", level: "review" },
      { code: "hsts-absent", level: "review" },
    ]);
    expect(deepFindings(csp, true)).toMatchObject([
      { code: "csp-absent", level: "review" },
    ]);
    expect(deepFindings(headers, true).map((item) => item.code)).toEqual([
      "hsts-absent",
    ]);
    expect(deepFindings(headers, false)).toHaveLength(2);
    expect(
      deepFindings(
        run("deep-csp", [{ code: "csp-absent" }], { applied: false }),
        true,
      ),
    ).toHaveLength(1);
  });

  it("scores clean and informational results highly", () => {
    expect(scoreDeepAudit(completeRuns()).value).toBe(100);
    const runs = completeRuns();
    runs[0] = run("deep-tls", [{ code: "tls-observed", level: "information" }]);
    expect(scoreDeepAudit(runs).value).toBe(100);
  });

  it("deducts critical findings, without double-counting historical CSP", () => {
    const runs = completeRuns();
    runs[1] = run("deep-csp", [], { applied: false });
    runs[2] = run("deep-security-headers", [
      { code: "csp-absent", level: "review" },
      { code: "hsts-absent", level: "review" },
    ]);
    expect(scoreDeepAudit(runs).value).toBe(76);
  });

  it("caps each control and stays within bounds for many important problems", () => {
    const runs = completeRuns();
    for (const id of diagnosticIds) {
      const index = runs.findIndex((item) => item.checkId === id);
      runs[index] = run(
        id,
        Array.from({ length: 20 }, (_, n) => ({
          code: `${id}-${n}`,
          level: "risk",
        })),
        id === "deep-csp" ? { applied: true } : {},
      );
    }
    expect(scoreDeepAudit(runs).value).toBe(0);
    expect(scoreDeepAudit(runs).value).toBeGreaterThanOrEqual(0);
    expect(scoreDeepAudit(completeRuns()).value).toBeLessThanOrEqual(100);
    expect(scoreDeepAudit(runs)).toEqual(scoreDeepAudit(runs));
  });

  it("makes missing or failed controls visible through coverage ceilings", () => {
    const noEvidence = scoreDeepAudit([]);
    expect(noEvidence.value).toBeNull();
    const missingCsp = completeRuns().filter(
      (item) => item.checkId !== "deep-csp",
    );
    expect(scoreDeepAudit(missingCsp)).toMatchObject({
      value: 74,
      limitedCoverage: true,
      completedControls: 7,
    });
    const failedCookies = completeRuns();
    failedCookies[3] = run("deep-cookies", [], {}, "failed");
    expect(scoreDeepAudit(failedCookies)).toMatchObject({
      value: 89,
      limitedCoverage: true,
    });
    const httpFailed = completeRuns();
    httpFailed[1] = run("deep-csp", [], {
      applied: false,
      httpObserved: false,
    });
    httpFailed.push(run("deep-http-observation", [], { errorKind: "timeout" }));
    expect(deepFindings(httpFailed[1], true, true)).toHaveLength(0);
    expect(scoreDeepAudit(httpFailed)).toMatchObject({
      value: 74,
      limitedCoverage: true,
    });
    const incompleteEvidence = completeRuns();
    incompleteEvidence[1] = {
      checkId: "deep-csp",
      status: "completed",
      evidence: [{ data: { applied: false } }],
    };
    expect(scoreDeepAudit(incompleteEvidence).value).toBe(74);
  });
});
