import {
  reportScoreCategoryForFindingCategory,
  type ReportScoreFinding,
  type ReportScorecard,
  type ReportScoreSeverity,
} from "./report-score";

export type ReportRecommendationLevel = "fix" | "improve" | "consider";

export type ReportRecommendationGroup<T extends ReportScoreFinding> = {
  key: string;
  primary: T;
  findings: T[];
  occurrenceCount: number;
  pageUrls: string[];
  level: ReportRecommendationLevel;
};

export type ReportRecommendationSummary<T extends ReportScoreFinding> = {
  groups: ReportRecommendationGroup<T>[];
  priorities: ReportRecommendationGroup<T>[];
  counts: Record<ReportRecommendationLevel, number>;
};

const severityRank: Record<ReportScoreSeverity, number> = {
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

const levelRank: Record<ReportRecommendationLevel, number> = {
  consider: 1,
  improve: 2,
  fix: 3,
};

const mediumFixCategories = new Set([
  "security-header",
  "tls",
  "availability",
  "network",
  "broken-link",
  "javascript",
]);

export function recommendationLevelForFinding(
  finding: ReportScoreFinding,
): ReportRecommendationLevel {
  if (finding.severity === "critical" || finding.severity === "high") {
    return "fix";
  }

  if (
    finding.severity === "medium" &&
    mediumFixCategories.has(finding.category)
  ) {
    return "fix";
  }

  if (finding.severity === "medium" || finding.severity === "low") {
    return "improve";
  }

  return "consider";
}

function highestSeverity<T extends ReportScoreFinding>(
  findings: readonly T[],
): T {
  return findings.reduce((current, finding) =>
    severityRank[finding.severity] > severityRank[current.severity]
      ? finding
      : current,
  );
}

function groupFindings<T extends ReportScoreFinding>(
  findings: readonly T[],
): ReportRecommendationGroup<T>[] {
  const grouped = new Map<string, T[]>();

  for (const finding of findings) {
    const existing = grouped.get(finding.code);
    if (existing) {
      existing.push(finding);
    } else {
      grouped.set(finding.code, [finding]);
    }
  }

  return [...grouped.entries()].map(([key, items]) => {
    const primary = highestSeverity(items);
    const pageUrls = [
      ...new Set(
        items.flatMap((finding) => (finding.pageUrl ? [finding.pageUrl] : [])),
      ),
    ];

    return {
      key,
      primary,
      findings: [...items],
      occurrenceCount: items.length,
      pageUrls,
      level: recommendationLevelForFinding(primary),
    };
  });
}

function coverageRankForFinding(
  finding: ReportScoreFinding,
  scorecard: ReportScorecard,
): number {
  const categoryKey = reportScoreCategoryForFindingCategory(finding.category);
  if (!categoryKey) return 0;

  const category = scorecard.categories.find(
    (item) => item.key === categoryKey,
  );
  if (!category) return 0;

  if (category.coverage.status === "complete") return 2;
  if (category.coverage.status === "partial") return 1;
  return 0;
}

function compareRecommendationGroups<T extends ReportScoreFinding>(
  a: ReportRecommendationGroup<T>,
  b: ReportRecommendationGroup<T>,
  scorecard: ReportScorecard,
): number {
  const levelDelta = levelRank[b.level] - levelRank[a.level];
  if (levelDelta !== 0) return levelDelta;

  const severityDelta =
    severityRank[b.primary.severity] - severityRank[a.primary.severity];
  if (severityDelta !== 0) return severityDelta;

  const coverageDelta =
    coverageRankForFinding(b.primary, scorecard) -
    coverageRankForFinding(a.primary, scorecard);
  if (coverageDelta !== 0) return coverageDelta;

  const occurrenceDelta =
    Math.min(10, b.occurrenceCount) - Math.min(10, a.occurrenceCount);
  if (occurrenceDelta !== 0) return occurrenceDelta;

  return a.key.localeCompare(b.key);
}

export function buildReportRecommendations<T extends ReportScoreFinding>(
  findings: readonly T[],
  scorecard: ReportScorecard,
  priorityLimit = 5,
): ReportRecommendationSummary<T> {
  const groups = groupFindings(findings).sort((a, b) =>
    compareRecommendationGroups(a, b, scorecard),
  );

  const counts: Record<ReportRecommendationLevel, number> = {
    fix: 0,
    improve: 0,
    consider: 0,
  };
  for (const group of groups) {
    counts[group.level] += 1;
  }

  const actionable = groups.filter((group) => group.level !== "consider");
  const priorityPool = actionable.length > 0 ? actionable : groups;

  return {
    groups,
    priorities: priorityPool.slice(0, Math.max(0, priorityLimit)),
    counts,
  };
}
