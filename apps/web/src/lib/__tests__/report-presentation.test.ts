import { describe, expect, it } from "vitest";
import {
  getFindingBusinessContext,
  getPriorityFindings,
  summarizeReportFindings,
} from "../report-presentation";

describe("report presentation", () => {
  const findings = [
    {
      category: "seo",
      severity: "medium" as const,
      code: "seo.title.missing",
      title: "Title absent",
    },
    {
      category: "availability",
      severity: "critical" as const,
      code: "availability.http-5xx",
      title: "Erreur serveur",
    },
    {
      category: "security-header",
      severity: "high" as const,
      code: "security-header.csp.missing",
      title: "CSP absente",
    },
    {
      category: "broken-link",
      severity: "low" as const,
      code: "broken-link.http-error",
      title: "Lien cassé",
    },
  ];

  it("summarizes severity counts without inventing a score", () => {
    expect(summarizeReportFindings(findings)).toMatchObject({
      total: 4,
      highOrCritical: 2,
      bySeverity: {
        critical: 1,
        high: 1,
        medium: 1,
        low: 1,
        info: 0,
      },
    });
  });

  it("selects the highest severity findings first", () => {
    expect(getPriorityFindings(findings, 2).map((item) => item.code)).toEqual([
      "availability.http-5xx",
      "security-header.csp.missing",
    ]);
  });

  it("adds a concrete impact and intervention context", () => {
    expect(getFindingBusinessContext(findings[2]!)).toMatchObject({
      intervention: "Configuration serveur / CDN",
      effort: "Modéré",
    });
    expect(
      getFindingBusinessContext(findings[2]!).impact.length,
    ).toBeGreaterThan(20);
  });
});
