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

describe("Cookies before interaction in Deep reports", () => {
  function renderConsent(
    cookieConsent: Record<string, unknown>,
    findings: Array<Record<string, unknown>> = [],
  ) {
    return renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {},
        checkRuns: [
          checkRun("deep-cookies", {
            title: "Cookies et consentement",
            findings,
            cookieConsent: {
              method: "fresh-context-no-interaction",
              status: "observed",
              observedWindowMs: 3_000,
              reasons: [],
              knownTrackerCount: 0,
              unknownPurposeCount: 0,
              cookies: [],
              ...cookieConsent,
            },
          }),
        ],
      }),
    );
  }

  it("shows purpose hints and actionable consent remediation without certifying the site", () => {
    const html = renderConsent(
      {
        knownTrackerCount: 1,
        unknownPurposeCount: 1,
        excludedThirdPartyRequests: 3,
        cookies: [
          {
            name: "_ga",
            domain: ".example.com",
            purpose: "analytics",
            provider: "Google Analytics",
          },
          { name: "session", domain: "example.com", purpose: "unknown" },
        ],
      },
      [
        {
          code: "cookie-tracker-before-consent",
          level: "review",
          summary: "Cookie _ga observé avant toute interaction.",
        },
      ],
    );
    expect(html).toContain("Cookies avant toute interaction");
    expect(html).toContain("Session vierge");
    expect(html).toContain("Google Analytics");
    expect(html).toContain("Finalité à confirmer");
    expect(html).toContain("3 requête(s) exclue(s)");
    expect(html).toContain(
      "Conditionner les cookies non essentiels au consentement",
    );
    expect(html).toContain("Ce contrôle ne certifie pas");
    expect(html).not.toContain("Aucun point nécessitant une action");
  });

  it.each(["unavailable", "limited"])(
    "does not show a green success for %s observation",
    (status) => {
      const html = renderConsent({
        status,
        reasons: ["time-budget"],
        observedWindowMs: 0,
      });
      expect(html).toContain(
        status === "limited"
          ? "Observation limitée"
          : "Observation indisponible",
      );
      expect(html).not.toContain("Aucun point nécessitant une action");
      expect(html).toContain("Couverture à vérifier");
    },
  );

  it("bounds the meaning of no observed known cookies and retains historical reports", () => {
    const html = renderConsent({});
    expect(html).toContain(
      "Aucun cookie de traceur connu observé dans cette fenêtre",
    );
    expect(html).toContain("Les domaines tiers restent bloqués");
    expect(html).toContain("autres stockages ne sont pas évalués");
    const historical = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {},
        checkRuns: [
          checkRun("deep-cookies", {
            title: "Cookies",
            summary: "Aucun cookie déclaré.",
            findings: [],
            cookies: [],
          }),
        ],
      }),
    );
    expect(historical).not.toContain("Cookies avant toute interaction");
    expect(historical).toContain("Aucun cookie déclaré");
  });
});
