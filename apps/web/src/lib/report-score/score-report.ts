import { reportCoverageForCategory } from "./coverage";
import { gradeForScore } from "./grade";
import { scoreReportCategory } from "./score-category";
import { securityHttpConfigurationPenalty } from "./security-http-penalty";
import {
  reportScoreCategoryDefinitions,
  type ReportScoreCategoryKey,
  type ReportScoreFinding,
  type ReportScorecard,
} from "./types";

const findingCategoriesByScoreCategory: Record<
  ReportScoreCategoryKey,
  readonly string[]
> = {
  "security-http": ["security-header"],
  "security-web": ["tls"],
  performance: ["performance", "javascript"],
  seo: ["seo"],
  accessibility: ["accessibility"],
  network: ["network", "availability", "broken-link"],
};

export function reportScoreCategoryForFindingCategory(
  findingCategory: string,
): ReportScoreCategoryKey | null {
  for (const [scoreCategory, findingCategories] of Object.entries(
    findingCategoriesByScoreCategory,
  ) as Array<[ReportScoreCategoryKey, readonly string[]]>) {
    if (findingCategories.includes(findingCategory)) return scoreCategory;
  }
  return null;
}

function findingsForCategory(
  findings: readonly ReportScoreFinding[],
  category: ReportScoreCategoryKey,
): ReportScoreFinding[] {
  const accepted = new Set(findingCategoriesByScoreCategory[category]);
  return findings.filter((finding) => accepted.has(finding.category));
}

function overallCoverageCap(input: {
  evaluatedWeight: number;
  hasPartialCategory: boolean;
}): number {
  if (input.evaluatedWeight < 60) return 69;
  if (input.evaluatedWeight < 80) return 79;
  if (input.evaluatedWeight < 100) return 89;
  if (input.hasPartialCategory) return 89;
  return 100;
}

/**
 * Global score = weighted average of categories that were actually evaluated.
 *
 * Missing coverage is never treated as a perfect score. Instead, the maximum
 * global score is capped according to the evaluated weight. A report can only
 * receive grade A when all weighted categories are evaluated and complete.
 */
export function scoreReport(input: {
  summary: unknown;
  findings: readonly ReportScoreFinding[];
}): ReportScorecard {
  const categories = reportScoreCategoryDefinitions.map((definition) =>
    scoreReportCategory({
      definition,
      findings: findingsForCategory(input.findings, definition.key),
      coverage: reportCoverageForCategory(input.summary, definition.key),
      additionalPenalty:
        definition.key === "security-http"
          ? securityHttpConfigurationPenalty(input.summary)
          : 0,
    }),
  );

  const evaluated = categories.filter(
    (category): category is (typeof categories)[number] & { score: number } =>
      category.score !== null,
  );
  const evaluatedWeight = evaluated.reduce(
    (total, category) => total + category.weight,
    0,
  );

  if (evaluatedWeight === 0) {
    return {
      version: "report-v2-1",
      score: null,
      rawScore: null,
      grade: null,
      coverage: "unavailable",
      coverageCap: null,
      evaluatedWeight: 0,
      categories,
    };
  }

  const weightedTotal = evaluated.reduce(
    (total, category) => total + category.score * category.weight,
    0,
  );
  const rawScore = Math.round(weightedTotal / evaluatedWeight);
  const hasPartialCategory = categories.some(
    (category) => category.coverage.status === "partial",
  );
  const coverageCap = overallCoverageCap({
    evaluatedWeight,
    hasPartialCategory,
  });
  const score = Math.min(rawScore, coverageCap);
  const coverage =
    evaluatedWeight === 100 && !hasPartialCategory ? "complete" : "partial";

  return {
    version: "report-v2-1",
    score,
    rawScore,
    grade: gradeForScore(score),
    coverage,
    coverageCap,
    evaluatedWeight,
    categories,
  };
}
