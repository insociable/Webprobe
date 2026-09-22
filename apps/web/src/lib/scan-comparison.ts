import {
  canCompareMissingFinding,
  type Severity,
} from "@agency-saas/contracts";

export type ComparableFinding = {
  fingerprint: string;
  severity: Severity;
  code: string;
  title: string;
  pageUrl: string | null;
};

export type CurrentFindingChange =
  | { change: "new"; previousSeverity: null }
  | { change: "worsened"; previousSeverity: Severity }
  | { change: "improved"; previousSeverity: Severity }
  | { change: "unchanged"; previousSeverity: Severity };

export type ScanComparison = {
  changesByFingerprint: Record<string, CurrentFindingChange>;
  resolvedFindings: ComparableFinding[];
  counts: {
    new: number;
    worsened: number;
    improved: number;
    unchanged: number;
    resolved: number;
  };
};

const severityRank: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function compareScanFindings(
  current: ComparableFinding[],
  previous: ComparableFinding[],
  summaries: {
    current: unknown;
    previous: unknown;
  } = { current: {}, previous: {} },
): ScanComparison {
  const previousByFingerprint = new Map(
    previous.map((finding) => [finding.fingerprint, finding]),
  );
  const currentFingerprints = new Set(
    current.map((finding) => finding.fingerprint),
  );
  const changesByFingerprint: Record<string, CurrentFindingChange> = {};
  const counts = {
    new: 0,
    worsened: 0,
    improved: 0,
    unchanged: 0,
    resolved: 0,
  };

  for (const finding of current) {
    const prior = previousByFingerprint.get(finding.fingerprint);
    if (!prior) {
      if (
        !canCompareMissingFinding(
          finding.code,
          summaries.current,
          summaries.previous,
        )
      ) {
        continue;
      }
      changesByFingerprint[finding.fingerprint] = {
        change: "new",
        previousSeverity: null,
      };
      counts.new += 1;
      continue;
    }

    const currentRank = severityRank[finding.severity];
    const previousRank = severityRank[prior.severity];

    if (currentRank > previousRank) {
      changesByFingerprint[finding.fingerprint] = {
        change: "worsened",
        previousSeverity: prior.severity,
      };
      counts.worsened += 1;
      continue;
    }

    if (currentRank < previousRank) {
      changesByFingerprint[finding.fingerprint] = {
        change: "improved",
        previousSeverity: prior.severity,
      };
      counts.improved += 1;
      continue;
    }

    changesByFingerprint[finding.fingerprint] = {
      change: "unchanged",
      previousSeverity: prior.severity,
    };
    counts.unchanged += 1;
  }

  const resolvedFindings = previous.filter(
    (finding) =>
      !currentFingerprints.has(finding.fingerprint) &&
      canCompareMissingFinding(
        finding.code,
        summaries.current,
        summaries.previous,
      ),
  );
  counts.resolved = resolvedFindings.length;

  return {
    changesByFingerprint,
    resolvedFindings,
    counts,
  };
}
