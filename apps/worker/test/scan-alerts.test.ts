import { describe, expect, it } from "vitest";
import type { GeneratedFinding } from "../src/findings.js";
import { detectScanDegradations } from "../src/scan-alerts.js";

function finding(
  input: Partial<GeneratedFinding> &
    Pick<GeneratedFinding, "fingerprint" | "severity">,
): GeneratedFinding {
  return {
    category: "availability",
    code: "test.finding",
    title: "Test finding",
    pageUrl: "https://example.com/",
    evidence: {},
    ...input,
  };
}

describe("scan degradation detection", () => {
  it("alerts on new medium/high/critical findings only", () => {
    const result = detectScanDegradations(
      [
        finding({ fingerprint: "low", severity: "low" }),
        finding({ fingerprint: "medium", severity: "medium" }),
        finding({ fingerprint: "high", severity: "high" }),
      ],
      [],
    );

    expect(result.map((item) => [item.fingerprint, item.change])).toEqual([
      ["medium", "new"],
      ["high", "new"],
    ]);
  });

  it("alerts only when an existing finding worsens", () => {
    const result = detectScanDegradations(
      [
        finding({ fingerprint: "same", severity: "medium" }),
        finding({ fingerprint: "worse", severity: "high" }),
        finding({ fingerprint: "better", severity: "medium" }),
      ],
      [
        { fingerprint: "same", severity: "medium" },
        { fingerprint: "worse", severity: "medium" },
        { fingerprint: "better", severity: "high" },
      ],
    );

    expect(result).toEqual([
      expect.objectContaining({
        fingerprint: "worse",
        change: "worsened",
        severity: "high",
        previousSeverity: "medium",
      }),
    ]);
  });

  it("treats a reappearing finding after a clean baseline as new", () => {
    const result = detectScanDegradations(
      [finding({ fingerprint: "reappeared", severity: "high" })],
      [],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      fingerprint: "reappeared",
      change: "new",
    });
  });
});
