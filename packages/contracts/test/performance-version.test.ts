import { describe, expect, it } from "vitest";
import {
  canCompareMissingFinding,
  canResolveFindingFromSummary,
  performanceMetricsComparable,
} from "../src/scan-completeness.js";
const summary = (metricVersion?: string) => ({
  scannerV2: {
    performance: { metricVersion },
    completeness: {
      performance: { status: "complete" },
      network: { status: "complete" },
    },
  },
});
describe("performance metric version compatibility", () => {
  it("preserves legacy behavior while preventing changes across different performance rules", () => {
    expect(performanceMetricsComparable(summary(), summary())).toBe(true);
    expect(performanceMetricsComparable(summary("2.0.0"), summary())).toBe(
      false,
    );
    expect(
      canCompareMissingFinding(
        "performance.cls.high",
        summary("2.0.0"),
        summary(),
      ),
    ).toBe(false);
    expect(
      canResolveFindingFromSummary(
        "performance.cls.high",
        summary("2.0.0"),
        summary(),
      ),
    ).toBe(false);
    expect(
      canResolveFindingFromSummary(
        "performance.cls.high",
        summary("2.0.0"),
        summary("2.0.0"),
      ),
    ).toBe(true);
    expect(
      canResolveFindingFromSummary("performance.cls.high", summary()),
    ).toBe(true);
    expect(
      canCompareMissingFinding("network.http", summary("2.0.0"), summary()),
    ).toBe(true);
  });
});
