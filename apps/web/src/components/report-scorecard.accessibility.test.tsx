import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportScorecard } from "./report-scorecard";
import type { ReportScorecard as Scorecard } from "../lib/report-score";

describe("ReportScorecard accessibility", () => {
  it("keeps the category score and coverage in the remediation link name", () => {
    const scorecard: Scorecard = {
      version: "report-v2-1",
      score: 82,
      rawScore: 82,
      grade: "B",
      coverage: "partial",
      coverageCap: null,
      evaluatedWeight: 75,
      categories: [
        {
          key: "security-http",
          label: "Sécurité HTTP",
          weight: 25,
          score: 82,
          rawScore: 82,
          grade: "B",
          coverage: { status: "partial", observedCount: 3, eligibleCount: 5 },
          coverageCap: null,
          penalty: 18,
          findingCount: 1,
          distinctFindingCount: 1,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ReportScorecard
        scorecard={scorecard}
        distinctProblems={1}
        occurrences={1}
        pageCount={5}
        categoryTargets={{ "security-http": "actions-http" }}
      />,
    );
    const categoryLink = html.match(
      /<a href="#actions-http"([\s\S]*?)<\/a>/,
    )?.[0];
    expect(categoryLink).toBeDefined();
    expect(categoryLink).not.toContain("aria-label=");
    expect(categoryLink).toContain("Sécurité HTTP");
    expect(categoryLink).toContain("Partielle · 3/5 pages");
    expect(categoryLink).toContain("Note B");
    expect(categoryLink).toContain("82");
  });
});
