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
    expect(html).toContain("Remédiation");
    expect(html).toContain("Définir une Content-Security-Policy");
    expect(html).toContain("Détails techniques");
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
  });

  it("keeps a Deep finding actionable while preserving technical evidence", () => {
    const html = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {},
        checkRuns: [
          checkRun("deep-resources", {
            title: "Ressources de page",
            summary: "Une ressource non chiffrée a été observée.",
            findings: [
              {
                code: "mixed-content-resource",
                level: "review",
                summary: "Ressource HTTP depuis une page HTTPS.",
                recommendation: "Servir la ressource en HTTPS.",
                observed: "http://assets.example/app.js",
              },
            ],
          }),
        ],
      }),
    );

    expect(html).toContain("Ressource HTTP depuis une page HTTPS.");
    expect(html).toContain("Remédiation");
    expect(html).toContain("Servir la ressource en HTTPS.");
    expect(html).toContain("Détails techniques");
    expect(html).toContain("mixed-content-resource");
    expect(html).toContain("http://assets.example/app.js");
  });
});