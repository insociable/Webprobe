import { gradeForScore } from "./grade";
import type {
  ReportCategoryScore,
  ReportScoreCategoryDefinition,
  ReportScoreCoverage,
  ReportScoreFinding,
  ReportScoreSeverity,
} from "./types";

const severityPenalty: Record<ReportScoreSeverity, number> = {
  info: 1,
  low: 4,
  medium: 12,
  high: 24,
  critical: 40,
};

const repeatedOccurrencePenalty: Record<
  ReportScoreSeverity,
  { increment: number; cap: number }
> = {
  info: { increment: 0, cap: 0 },
  low: { increment: 1, cap: 3 },
  medium: { increment: 2, cap: 8 },
  high: { increment: 3, cap: 12 },
  critical: { increment: 4, cap: 16 },
};

const severityRank: Record<ReportScoreSeverity, number> = {
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

/**
 * Report V2 scoring deliberately separates issue severity from analysis
 * completeness:
 *
 * - each distinct rule/code receives one severity penalty;
 * - repeated occurrences add a small, capped penalty, so a shared component
 *   broken on many pages matters more without counting as many independent
 *   issues;
 * - partial analysis caps the best possible score;
 * - unavailable analysis never becomes an implicit 100/100.
 *
 * Changing these constants is a scoring-version change, not a UI tweak.
 */
function highestSeverity(
  findings: readonly ReportScoreFinding[],
): ReportScoreSeverity {
  return findings.reduce<ReportScoreSeverity>(
    (current, finding) =>
      severityRank[finding.severity] > severityRank[current]
        ? finding.severity
        : current,
    "info",
  );
}

function penaltyForGroup(findings: readonly ReportScoreFinding[]): number {
  const severity = highestSeverity(findings);
  const repeat = repeatedOccurrencePenalty[severity];
  const repeatedCount = Math.max(0, findings.length - 1);

  return (
    severityPenalty[severity] +
    Math.min(repeat.cap, repeatedCount * repeat.increment)
  );
}

function groupedByCode(
  findings: readonly ReportScoreFinding[],
): Map<string, ReportScoreFinding[]> {
  const groups = new Map<string, ReportScoreFinding[]>();

  for (const finding of findings) {
    const group = groups.get(finding.code);
    if (group) {
      group.push(finding);
    } else {
      groups.set(finding.code, [finding]);
    }
  }

  return groups;
}

export function partialCoverageScoreCap(coverage: ReportScoreCoverage): number {
  if (
    coverage.observedCount !== undefined &&
    coverage.eligibleCount !== undefined &&
    coverage.eligibleCount > 0
  ) {
    const ratio = Math.min(
      1,
      Math.max(0, coverage.observedCount / coverage.eligibleCount),
    );
    return Math.min(89, Math.max(70, Math.round(70 + ratio * 19)));
  }

  return 80;
}

function effectiveCoverage(
  coverage: ReportScoreCoverage,
  findingCount: number,
): ReportScoreCoverage {
  if (coverage.status !== "unavailable" || findingCount === 0) {
    return coverage;
  }

  return {
    status: "partial",
    reason: "observed-findings-with-incomplete-coverage",
  };
}

export function scoreReportCategory(input: {
  definition: ReportScoreCategoryDefinition;
  findings: readonly ReportScoreFinding[];
  coverage: ReportScoreCoverage;
  additionalPenalty?: number;
}): ReportCategoryScore {
  const coverage = effectiveCoverage(input.coverage, input.findings.length);
  const groups = groupedByCode(input.findings);
  const findingPenalty = [...groups.values()].reduce(
    (total, group) => total + penaltyForGroup(group),
    0,
  );
  const additionalPenalty = Math.max(0, input.additionalPenalty ?? 0);
  const penalty = findingPenalty + additionalPenalty;

  if (coverage.status === "unavailable") {
    return {
      key: input.definition.key,
      label: input.definition.label,
      weight: input.definition.weight,
      score: null,
      rawScore: null,
      grade: null,
      coverage,
      coverageCap: null,
      penalty,
      findingCount: input.findings.length,
      distinctFindingCount: groups.size,
    };
  }

  const rawScore = Math.max(0, 100 - penalty);
  const coverageCap =
    coverage.status === "partial" ? partialCoverageScoreCap(coverage) : 100;
  const score = Math.min(rawScore, coverageCap);

  return {
    key: input.definition.key,
    label: input.definition.label,
    weight: input.definition.weight,
    score,
    rawScore,
    grade: gradeForScore(score),
    coverage,
    coverageCap,
    penalty,
    findingCount: input.findings.length,
    distinctFindingCount: groups.size,
  };
}
