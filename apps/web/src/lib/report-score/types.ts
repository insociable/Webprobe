export type ReportScoreSeverity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type ReportScoreFinding = {
  category: string;
  severity: ReportScoreSeverity;
  code: string;
  pageUrl?: string | null;
};

export type ReportScoreCoverageStatus = "complete" | "partial" | "unavailable";

export type ReportScoreCoverage = {
  status: ReportScoreCoverageStatus;
  observedCount?: number;
  eligibleCount?: number;
  reason?: string;
};

export type ReportGrade = "A" | "B" | "C" | "D" | "E";

export type ReportScoreCategoryKey =
  | "security-http"
  | "security-web"
  | "performance"
  | "seo"
  | "accessibility"
  | "network";

export type ReportScoreCategoryDefinition = {
  key: ReportScoreCategoryKey;
  label: string;
  weight: number;
};

export type ReportCategoryScore = {
  key: ReportScoreCategoryKey;
  label: string;
  weight: number;
  score: number | null;
  rawScore: number | null;
  grade: ReportGrade | null;
  coverage: ReportScoreCoverage;
  coverageCap: number | null;
  penalty: number;
  findingCount: number;
  distinctFindingCount: number;
};

export type ReportScorecard = {
  version: "report-v2-1";
  score: number | null;
  rawScore: number | null;
  grade: ReportGrade | null;
  coverage: ReportScoreCoverageStatus;
  coverageCap: number | null;
  evaluatedWeight: number;
  categories: ReportCategoryScore[];
};

export const reportScoreCategoryDefinitions: readonly ReportScoreCategoryDefinition[] =
  [
    { key: "security-http", label: "Sécurité HTTP", weight: 25 },
    { key: "security-web", label: "Sécurité Web", weight: 15 },
    { key: "performance", label: "Performance", weight: 20 },
    { key: "seo", label: "SEO", weight: 15 },
    { key: "accessibility", label: "Accessibilité", weight: 15 },
    { key: "network", label: "Réseau / disponibilité", weight: 10 },
  ] as const;
