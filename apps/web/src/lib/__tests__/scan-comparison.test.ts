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

  it("treats an empty current scan as all previous findings resolved", () => {
    const comparison = compareScanFindings(
      [],
      [finding("one", "medium"), finding("two", "high")],
    );

    expect(comparison.counts.resolved).toBe(2);
    expect(comparison.resolvedFindings).toHaveLength(2);
  });
});
