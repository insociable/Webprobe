import { describe, expect, it } from "vitest";
import {
  compareScanFindings,
  type ComparableFinding,
} from "../scan-comparison";

function finding(
  fingerprint: string,
  severity: ComparableFinding["severity"],
): ComparableFinding {
  return {
    fingerprint,
    severity,
    code: `test.${fingerprint}`,
    title: `Finding ${fingerprint}`,
    pageUrl: "https://example.com/",
  };
}

describe("scan finding comparison", () => {
  it("classifies new, worsened, improved, unchanged and resolved findings", () => {
    const comparison = compareScanFindings(
      [
        finding("new", "medium"),
        finding("worse", "high"),
        finding("better", "medium"),
        finding("same", "low"),
      ],
      [
        finding("worse", "medium"),
        finding("better", "high"),
        finding("same", "low"),
        finding("gone", "critical"),
      ],
    );

    expect(comparison.counts).toEqual({
      new: 1,
      worsened: 1,
      improved: 1,
      unchanged: 1,
      resolved: 1,
    });
    expect(comparison.changesByFingerprint).toEqual({
      new: { change: "new", previousSeverity: null },
      worse: { change: "worsened", previousSeverity: "medium" },
      better: { change: "improved", previousSeverity: "high" },
      same: { change: "unchanged", previousSeverity: "low" },
    });
    expect(comparison.resolvedFindings).toEqual([finding("gone", "critical")]);
  });

  it("treats missing scanner-v2 findings as unknown unless both analyzers were complete", () => {
    const networkFinding: ComparableFinding = {
      fingerprint: "network",
      severity: "high",
      code: "network.http-5xx",
      title: "Network failure",
      pageUrl: "https://example.com/app.js",
    };
    const complete = {
      scannerV2: {
        completeness: {
          network: { status: "complete" },
        },
      },
    };
    const partial = {
      scannerV2: {
        completeness: {
          network: { status: "partial" },
        },
      },
    };

    const partialRecovery = compareScanFindings([], [networkFinding], {
      current: partial,
      previous: complete,
    });
    expect(partialRecovery.counts.resolved).toBe(0);
    expect(partialRecovery.resolvedFindings).toEqual([]);

    const legacyBaseline = compareScanFindings([networkFinding], [], {
      current: complete,
      previous: {},
    });
    expect(legacyBaseline.counts.new).toBe(0);
    expect(legacyBaseline.changesByFingerprint).toEqual({});

    const confirmedRecovery = compareScanFindings([], [networkFinding], {
      current: complete,
      previous: complete,
    });
    expect(confirmedRecovery.counts.resolved).toBe(1);
  });

  it("treats an empty current scan as all previous findings resolved", () => {
    const comparison = compareScanFindings(
      [],
      [finding("one", "medium"), finding("two", "high")],
    );

    expect(comparison.counts.resolved).toBe(2);
    expect(comparison.resolvedFindings).toHaveLength(2);
  });
});
