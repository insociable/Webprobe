import type { ReportScoreFinding } from "./report-score";

type UnknownRecord = Record<string, unknown>;

export type ReportCorrelation = {
  id: string;
  title: string;
  summary: string;
  priority: "medium" | "high";
  evidence: string[];
};

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

function hasFinding(
  findings: readonly ReportScoreFinding[],
  code: string,
): boolean {
  return findings.some((finding) => finding.code === code);
}

function observedHttps(summary: unknown): boolean {
  const http = record(record(summary)?.http);
  if (!http || http.ok !== true) return false;

  const finalUrl =
    typeof http.finalUrl === "string" ? http.finalUrl.trim() : "";
  const tls = record(http.tls);
  const protocol = typeof tls?.protocol === "string" ? tls.protocol.trim() : "";

  return finalUrl.startsWith("https://") && protocol.length > 0;
}

export function correlateReportSignals(input: {
  summary: unknown;
  findings: readonly ReportScoreFinding[];
}): ReportCorrelation[] {
  const correlations: ReportCorrelation[] = [];

  if (
    observedHttps(input.summary) &&
    hasFinding(input.findings, "security-header.hsts.missing")
  ) {
    correlations.push({
      id: "https-without-hsts",
      title: "HTTPS actif sans HSTS",
      summary:
        "Le site utilise HTTPS, mais aucun en-tête HSTS n’a été observé. Le navigateur n’est donc pas explicitement contraint de réutiliser HTTPS lors des visites futures.",
      priority: "medium",
      evidence: ["HTTPS et TLS observés", "Header HSTS absent"],
    });
  }

  return correlations;
}
