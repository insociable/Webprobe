import type {
  ScannerV2Analyzer,
  ScannerV2AnalyzerStatus,
} from "@agency-saas/contracts";
import { scannerV2AnalyzerStatusFromSummary } from "@agency-saas/contracts";

export const scannerV2Analyzers = [
  "crawl",
  "network",
  "performance",
  "seo",
] as const satisfies readonly ScannerV2Analyzer[];

export function scannerV2Quality(
  summary: unknown,
): Record<ScannerV2Analyzer, ScannerV2AnalyzerStatus> | null {
  const result = {} as Record<ScannerV2Analyzer, ScannerV2AnalyzerStatus>;

  for (const analyzer of scannerV2Analyzers) {
    const status = scannerV2AnalyzerStatusFromSummary(summary, analyzer);
    if (!status) return null;
    result[analyzer] = status;
  }

  return result;
}
