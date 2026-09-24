import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeepAuditReport } from "./deep-audit-report";

function checkRun(
  checkId: string,
  data: Record<string, unknown>,
  id = checkId,
) {
  return {
    id,
    checkId,
    checkVersion: "1.0.0",
    status: "completed",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    completedAt: new Date("2026-01-01T00:00:01Z"),
    durationMs: 10,
    budgetUsed: {},
    evidence: [{ data }],
    skipReason: null,
  };
}

describe("Deep audit report rendering", () => {
  it("shows one actionable CSP diagnosis on historical evidence", () => {
    const html = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {},
        checkRuns: [
          checkRun("deep-csp", {
            title: "Politique CSP",
            summary: "Aucune CSP observée.",
            applied: false,
            findings: [],
          }),
          checkRun("deep-security-headers", {
            title: "En-têtes de sécurité",
            findings: [
              {
                code: "csp-absent",
                level: "review",
                summary: "CSP appliquée absente.",
              },
            ],
          }),
        ],
      }),
    );
    expect(html).toContain("Aucune CSP observée.");
    expect(html).toContain("Aucune CSP appliquée n&#x27;a été observée.");
    expect(html).not.toContain("Aucun point nécessitant une action");
    expect(html).toContain("Score Deep");
    expect(html).toContain("/ 100");
    expect(html).toContain("Le diagnostic de la CSP figure dans le contrôle");
    expect(html).toContain("Couverture à vérifier");
  });
});
