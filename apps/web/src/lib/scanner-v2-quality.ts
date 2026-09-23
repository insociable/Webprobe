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

export type ScannerV2CrawlLimitation =
  | "robots-restricted"
  | "robots-unavailable";

export function scannerV2CrawlLimitation(
  summary: unknown,
): ScannerV2CrawlLimitation | null {
  if (typeof summary !== "object" || summary === null) return null;
  const scannerV2 = (summary as { scannerV2?: unknown }).scannerV2;
  if (typeof scannerV2 !== "object" || scannerV2 === null) return null;
  const crawl = (scannerV2 as { crawl?: unknown }).crawl;
  if (typeof crawl !== "object" || crawl === null) return null;
  const value = crawl as {
    robotsRestricted?: unknown;
    robotsPolicyUnavailable?: unknown;
  };
  if (value.robotsPolicyUnavailable === true) return "robots-unavailable";
  if (value.robotsRestricted === true) return "robots-restricted";
  return null;
}

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
