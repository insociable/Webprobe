import type { Severity } from "@agency-saas/contracts";
import type { GeneratedFinding } from "./findings.js";

export type PreviousFindingSnapshot = {
  fingerprint: string;
  severity: Severity;
};

export type ScanDegradation = {
  change: "new" | "worsened";
  fingerprint: string;
  severity: Severity;
  previousSeverity: Severity | null;
  code: string;
  title: string;
  pageUrl: string;
};

const severityRank: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const minimumAlertRank = severityRank.medium;

export function detectScanDegradations(
  current: GeneratedFinding[],
  previous: PreviousFindingSnapshot[],
): ScanDegradation[] {
  const previousByFingerprint = new Map(
    previous.map((finding) => [finding.fingerprint, finding.severity]),
  );
  const degradations: ScanDegradation[] = [];

  for (const finding of current) {
    if (severityRank[finding.severity] < minimumAlertRank) {
      continue;
    }

    const previousSeverity = previousByFingerprint.get(finding.fingerprint);

    if (!previousSeverity) {
      degradations.push({
        change: "new",
        fingerprint: finding.fingerprint,
        severity: finding.severity,
        previousSeverity: null,
        code: finding.code,
        title: finding.title,
        pageUrl: finding.pageUrl,
      });
      continue;
    }

    if (severityRank[finding.severity] <= severityRank[previousSeverity]) {
      continue;
    }

    degradations.push({
      change: "worsened",
      fingerprint: finding.fingerprint,
      severity: finding.severity,
      previousSeverity,
      code: finding.code,
      title: finding.title,
      pageUrl: finding.pageUrl,
    });
  }

  return degradations;
}
