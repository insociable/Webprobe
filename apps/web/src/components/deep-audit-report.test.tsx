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

function completedDeepRuns() {
  return [
    "deep-http-observation",
    "deep-browser-observation",
    "deep-tls",
    "deep-browser-meta",
    "deep-security-headers",
    "deep-csp",
    "deep-cookies",
    "deep-resources",
    "deep-endpoints",
    "deep-forms",
  ]
    .map((id) => ({
      ...checkRun(id, {
        findings: [],
        ...(id === "deep-csp" ? { applied: true } : {}),
        ...(id === "deep-csp" ||
        id === "deep-security-headers" ||
        id === "deep-cookies"
          ? { coverage: "observed" }
          : {}),
      }),
      checkVersion:
        id === "deep-csp" ||
        id === "deep-security-headers" ||
        id === "deep-cookies"
          ? "2.0.0"
          : "1.0.0",
    }))
    .concat([
      checkRun("deep-performance", {
        metricVersion: "2.0.0",
        coverage: "limited",
        pageUrl: "https://example.test/",
        metrics: { ttfbMs: { value: 103 }, cls: { value: 0 } },
        reasons: ["blocked-resources"],
        resources: { observedCount: 4, blockedCount: 1 },
      }),
    ]);
}

describe("Deep navigation coverage transparency", () => {
  it("distinguishes executed controls from site-wide coverage", () => {
    const html = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {},
        checkRuns: completedDeepRuns().map((run) =>
          run.checkId === "deep-browser-observation"
            ? {
                ...run,
                evidence: [
                  {
                    data: {
                      pageCount: 1,
                      navigationScope: "entry-document-only",
                      documentLinks: {
                        sampled: 100,
                        inScopeDistinct: 14,
                        externalDistinct: 2,
                        truncated: true,
                      },
                    },
                  },
                ],
              }
            : run,
        ),
      }),
    );
    expect(html).toContain("Portée réelle de l’observation navigateur");
    expect(html).toContain("14");
    expect(html).toContain("Échantillon limité aux 100 premiers liens");
    expect(html).not.toContain("Couverture complète du périmètre");
    expect(html).toContain("Il ne suit pas automatiquement les liens");
  });

  it("does not call checks complete when a non-scored check was skipped", () => {
    const runs = completedDeepRuns().map((run) =>
      run.checkId === "deep-performance" ? { ...run, status: "skipped" } : run,
    );
    const html = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {},
        checkRuns: runs,
      }),
    );
    expect(html).toContain("Couverture à vérifier");
    expect(html).not.toContain("Contrôles Deep exécutés");
  });

  it("keeps the limitation visible for historical evidence with no link counts", () => {
    const html = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {},
        checkRuns: completedDeepRuns(),
      }),
    );
    expect(html).toContain("Portée réelle de l’observation navigateur");
    expect(html).not.toContain("Échantillon de 0");
  });
});

describe("Deep audit report rendering", () => {
  it("keeps performance-only coverage limits local, for historical Deep reports too", () => {
    const html = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {
          v3Coverage: {
            totalChecks: 11,
            completedChecks: 11,
            skippedChecks: 0,
            failedChecks: 0,
            reasons: ["observation-evidence-limited"],
          },
        },
        checkRuns: completedDeepRuns(),
      }),
    );
    expect(html).toContain("Contrôles exécutés · Performance partielle");
    expect(html).toContain("Mesures partielles");
    expect(html).toContain("Limites des ressources observées");
    expect(html).toContain("11");
    expect(html).not.toContain("Certaines limites ont réduit la couverture");
    expect(html).not.toContain("Preuves partiellement observées");
    expect(html).not.toContain("Couverture complète du périmètre");
  });

  it("preserves global coverage warnings if security evidence is also limited", () => {
    const runs = completedDeepRuns().map((run) =>
      run.checkId === "deep-csp"
        ? {
            ...run,
            evidence: [
              {
                data: {
                  coverage: "limited",
                  applied: true,
                  findings: [],
                },
              },
            ],
          }
        : run,
    );
    const html = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {
          v3Coverage: {
            reasons: ["observation-evidence-limited"],
          },
        },
        checkRuns: runs,
      }),
    );
    expect(html).toContain("Couverture à vérifier");
    expect(html).toContain("Certaines limites ont réduit la couverture");
    expect(html).toContain("Preuves partiellement observées");
  });

  it("retains independent network and budget warnings despite partial performance", () => {
    const html = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {
          v3Coverage: {
            reasons: ["observation-evidence-limited", "budget-time"],
          },
        },
        checkRuns: completedDeepRuns(),
      }),
    );
    expect(html).toContain("Couverture à vérifier");
    expect(html).toContain("Temps d’analyse maximal atteint");
    expect(html).not.toContain("Preuves partiellement observées");
  });
  it("shows neutral partial performance coverage without the generic Deep warning", () => {
    const html = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {},
        checkRuns: [
          checkRun("deep-performance", {
            title: "Performance observée",
            summary: "Observation de laboratoire",
            metricVersion: "2.0.0",
            coverage: "limited",
            pageUrl: "https://example.test/",
            metrics: { ttfbMs: { value: 103 }, fcpMs: { value: 384 } },
            reasons: ["resource-size-unavailable"],
            resources: { observedCount: 3, blockedCount: 0 },
          }),
        ],
      }),
    );
    expect(html).toContain("Mesures partielles");
    expect(html).toContain("Certaines ressources ou mesures");
    expect(html).toContain("103");
    expect(html).toContain("Limites des ressources observées");
    expect(html).not.toContain("Couverture partielle : certaines preuves");
    expect(html).not.toContain(
      "aucun résultat favorable ne peut en être déduit",
    );
  });
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

describe("versioned Deep evidence in reports", () => {
  it("shows partial coverage, source and version without leaking historical tokens", () => {
    const current = {
      ...checkRun("deep-csp", {
        title: "Politique CSP",
        summary:
          "Politique partielle sur https://example.com/path?token=secret",
        applied: true,
        coverage: "limited",
        pageUrl: "https://example.com/path?token=secret",
        findings: [],
        directives: {
          "script-src": ["'nonce-rawsecret'"],
          "report-uri": [
            "/collect?key=relative-secret",
            "//user:password@reports.example/collect?key=private",
          ],
        },
      }),
      checkVersion: "2.0.0",
    };
    const html = renderToStaticMarkup(
      createElement(DeepAuditReport, {
        status: "completed",
        summary: {},
        checkRuns: [current],
      }),
    );
    expect(html).toContain("Couverture partielle");
    expect(html).toContain("règles v2.0.0");
    expect(html).toContain("Page observée");
    expect(html).not.toContain("Aucun point nécessitant une action");
    expect(html).not.toContain("token=secret");
    expect(html).not.toContain("rawsecret");
    expect(html).not.toContain("relative-secret");
    expect(html).not.toContain("user:password");
    expect(html).not.toContain("key=private");
  });
});
