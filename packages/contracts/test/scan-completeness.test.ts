import { describe, expect, it } from "vitest";
import {
  canCompareMissingFinding,
  canResolveFindingFromSummary,
  scannerV2AnalyzerForFindingCode,
} from "../src/scan-completeness";

function summary(status: "complete" | "partial" | "unavailable") {
  return {
    scannerV2: {
      completeness: {
        crawl: { status },
        network: { status },
        performance: { status },
        seo: { status },
      },
    },
  };
}

describe("scan comparison completeness", () => {
  it("maps scanner findings to the analyzer that proves absence", () => {
    expect(scannerV2AnalyzerForFindingCode("network.http-5xx")).toBe("network");
    expect(scannerV2AnalyzerForFindingCode("performance.lcp.slow")).toBe(
      "performance",
    );
    expect(scannerV2AnalyzerForFindingCode("seo.noindex")).toBe("seo");
    expect(scannerV2AnalyzerForFindingCode("broken-link.http-error")).toBe(
      "crawl",
    );
    expect(scannerV2AnalyzerForFindingCode("availability.http-5xx")).toBeNull();
  });

  it("does not infer new or resolved scanner findings from partial or legacy scans", () => {
    expect(
      canCompareMissingFinding(
        "network.http-5xx",
        summary("complete"),
        summary("partial"),
      ),
    ).toBe(false);
    expect(
      canCompareMissingFinding("network.http-5xx", summary("complete"), {}),
    ).toBe(false);
    expect(
      canCompareMissingFinding(
        "network.http-5xx",
        summary("complete"),
        summary("complete"),
      ),
    ).toBe(true);
  });

  it("requires only the current scan to be complete for recovery of an observed incident", () => {
    expect(
      canResolveFindingFromSummary("seo.noindex", summary("partial")),
    ).toBe(false);
    expect(
      canResolveFindingFromSummary("seo.noindex", summary("complete")),
    ).toBe(true);
    expect(canResolveFindingFromSummary("availability.http-5xx", {})).toBe(
      true,
    );
  });
});
