export type ScannerV2Analyzer = "crawl" | "network" | "performance" | "seo";

export type ScannerV2AnalyzerStatus = "complete" | "partial" | "unavailable";

export function scannerV2AnalyzerForFindingCode(
  code: string,
): ScannerV2Analyzer | null {
  if (code.startsWith("network.")) return "network";
  if (code.startsWith("performance.")) return "performance";
  if (code.startsWith("seo.")) return "seo";
  if (
    code.startsWith("broken-link.") ||
    code.startsWith("javascript.") ||
    code.startsWith("accessibility.")
  ) {
    return "crawl";
  }
  return null;
}

export function scannerV2AnalyzerStatusFromSummary(
  summary: unknown,
  analyzer: ScannerV2Analyzer,
): ScannerV2AnalyzerStatus | null {
  if (typeof summary !== "object" || summary === null) return null;
  const scannerV2 = (summary as { scannerV2?: unknown }).scannerV2;
  if (typeof scannerV2 !== "object" || scannerV2 === null) return null;
  const completeness = (scannerV2 as { completeness?: unknown }).completeness;
  if (typeof completeness !== "object" || completeness === null) return null;
  const analyzerState = (completeness as Record<string, unknown>)[analyzer];
  if (typeof analyzerState !== "object" || analyzerState === null) return null;
  const status = (analyzerState as { status?: unknown }).status;
  return status === "complete" ||
    status === "partial" ||
    status === "unavailable"
    ? status
    : null;
}

export function canResolveFindingFromSummary(
  code: string,
  currentSummary: unknown,
  previousSummary?: unknown,
): boolean {
  const analyzer = scannerV2AnalyzerForFindingCode(code);
  if (!analyzer) return true;
  if (
    analyzer === "performance" &&
    !performanceMetricsComparable(currentSummary, previousSummary)
  )
    return false;
  return (
    scannerV2AnalyzerStatusFromSummary(currentSummary, analyzer) === "complete"
  );
}

export function canCompareNewFinding(
  previousSummary: unknown,
  _category: string,
  code: string,
): boolean {
  const analyzer = scannerV2AnalyzerForFindingCode(code);
  if (!analyzer) return true;
  return (
    scannerV2AnalyzerStatusFromSummary(previousSummary, analyzer) === "complete"
  );
}

export function canCompareMissingFinding(
  code: string,
  currentSummary: unknown,
  previousSummary: unknown,
): boolean {
  const analyzer = scannerV2AnalyzerForFindingCode(code);
  if (!analyzer) return true;
  if (
    analyzer === "performance" &&
    !performanceMetricsComparable(currentSummary, previousSummary)
  )
    return false;
  return (
    scannerV2AnalyzerStatusFromSummary(currentSummary, analyzer) ===
      "complete" &&
    scannerV2AnalyzerStatusFromSummary(previousSummary, analyzer) === "complete"
  );
}

export function performanceMetricVersion(summary: unknown): string {
  if (!summary || typeof summary !== "object") return "1.0.0";
  const scanner = (summary as { scannerV2?: unknown }).scannerV2;
  if (!scanner || typeof scanner !== "object") return "1.0.0";
  const performance = (scanner as { performance?: unknown }).performance;
  if (!performance || typeof performance !== "object") return "1.0.0";
  const version = (performance as { metricVersion?: unknown }).metricVersion;
  return typeof version === "string" ? version.slice(0, 32) : "1.0.0";
}
export function performanceMetricsComparable(
  current: unknown,
  previous: unknown,
): boolean {
  return (
    performanceMetricVersion(current) === performanceMetricVersion(previous)
  );
}
