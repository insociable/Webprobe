import { scannerV2AnalyzerStatusFromSummary } from "@agency-saas/contracts";
import type { ReportScoreCategoryKey, ReportScoreCoverage } from "./types";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isInteger(value)
    ? value
    : undefined;
}

function scannerV2CompletenessEntry(
  summary: unknown,
  analyzer: "crawl" | "network" | "performance" | "seo",
): UnknownRecord | null {
  const root = record(summary);
  const scannerV2 = record(root?.scannerV2);
  const completeness = record(scannerV2?.completeness);
  return record(completeness?.[analyzer]);
}

function scannerCoverage(
  summary: unknown,
  analyzer: "crawl" | "network" | "performance" | "seo",
): ReportScoreCoverage {
  const status = scannerV2AnalyzerStatusFromSummary(summary, analyzer);
  if (!status) {
    return {
      status: "unavailable",
      reason: "scanner-v2-completeness-missing",
    };
  }

  const entry = scannerV2CompletenessEntry(summary, analyzer);
  const observedCount = finiteNonNegativeInteger(entry?.observedPageCount);
  const eligibleCount = finiteNonNegativeInteger(entry?.eligiblePageCount);

  return {
    status,
    ...(observedCount !== undefined ? { observedCount } : {}),
    ...(eligibleCount !== undefined ? { eligibleCount } : {}),
  };
}

function httpProbe(summary: unknown): UnknownRecord | null {
  return record(record(summary)?.http);
}

function securityHttpCoverage(summary: unknown): ReportScoreCoverage {
  const http = httpProbe(summary);
  if (!http || http.ok !== true || !Array.isArray(http.securityHeaders)) {
    return { status: "unavailable", reason: "http-security-probe-unavailable" };
  }

  const expectedControlCount = http.securityHeaders.filter((entry) => {
    const observation = record(entry);
    return observation?.expected === true;
  }).length;

  if (expectedControlCount === 0) {
    return {
      status: "unavailable",
      reason: "http-security-controls-unavailable",
    };
  }

  return { status: "complete" };
}

function securityWebCoverage(summary: unknown): ReportScoreCoverage {
  const http = httpProbe(summary);
  const tls = record(http?.tls);

  if (
    http?.ok === true &&
    typeof tls?.protocol === "string" &&
    tls.protocol.length > 0
  ) {
    return { status: "complete" };
  }

  return { status: "unavailable", reason: "tls-observation-unavailable" };
}

function networkCoverage(summary: unknown): ReportScoreCoverage {
  const scanner = scannerCoverage(summary, "network");

  if (scanner.status !== "unavailable") {
    return scanner;
  }

  const http = httpProbe(summary);
  if (http && typeof http.ok === "boolean") {
    return {
      status: "partial",
      reason: "http-probe-only",
    };
  }

  return scanner;
}

export function reportCoverageForCategory(
  summary: unknown,
  category: ReportScoreCategoryKey,
): ReportScoreCoverage {
  switch (category) {
    case "security-http":
      return securityHttpCoverage(summary);
    case "security-web":
      return securityWebCoverage(summary);
    case "performance":
      return scannerCoverage(summary, "performance");
    case "seo":
      return scannerCoverage(summary, "seo");
    case "accessibility":
      return scannerCoverage(summary, "crawl");
    case "network":
      return networkCoverage(summary);
  }
}
