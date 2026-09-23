import { describe, expect, it } from "vitest";
import {
  getFindingBusinessContext,
  getFindingDisplayTitle,
  getPriorityFindings,
  groupFindingsByReportSection,
  reportSectionKeyForFinding,
  summarizeReportFindings,
  summarizeReportSections,
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

  it("maps findings into stable commercial report sections", () => {
    expect(reportSectionKeyForFinding(findings[1]!)).toBe("network");
    expect(reportSectionKeyForFinding(findings[2]!)).toBe("security");
    expect(reportSectionKeyForFinding(findings[0]!)).toBe("seo");

    expect(
      summarizeReportSections(findings).map((section) => ({
        key: section.definition.key,
        total: section.total,
        highOrCritical: section.highOrCritical,
      })),
    ).toEqual([
      { key: "security", total: 1, highOrCritical: 1 },
      { key: "seo", total: 1, highOrCritical: 0 },
      { key: "network", total: 2, highOrCritical: 1 },
    ]);

    expect(
      groupFindingsByReportSection(findings).map((section) => ({
        key: section.definition.key,
        codes: section.findings.map((finding) => finding.code),
      })),
    ).toEqual([
      {
        key: "security",
        codes: ["security-header.csp.missing"],
      },
      { key: "seo", codes: ["seo.title.missing"] },
      {
        key: "network",
        codes: ["availability.http-5xx", "broken-link.http-error"],
      },
    ]);
  });

  it("uses rule-specific titles and impacts for repeated accessibility findings", () => {
    const landmark = {
      category: "accessibility",
      severity: "medium" as const,
      code: "accessibility.landmark-one-main",
      title: "Accessibilité : règle landmark-one-main non respectée",
    };

    expect(getFindingDisplayTitle(landmark)).toContain("<main>");
    expect(getFindingBusinessContext(landmark).impact).toContain(
      "lecteur d’écran",
    );
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
