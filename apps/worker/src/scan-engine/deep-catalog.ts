import type { HttpProbeResult, ProbeCookie } from "../http-probe.js";
import type { BrowserRuntimeObservation } from "../browser-runtime.js";
import type { CheckDefinition } from "./check-registry.js";
import { createEvidence, type CheckEvidence } from "./evidence.js";

type Finding = {
  code: string;
  level: "information" | "review" | "risk";
  summary: string;
  recommendation: string | null;
  observed?: string | number | boolean | null;
};

function evidence(
  id: string,
  title: string,
  summary: string,
  findings: Finding[],
  details: Record<string, unknown>,
  confidence = 0.95,
): CheckEvidence {
  return createEvidence({
    checkId: id,
    checkVersion: "1.0.0",
    classification: "observation",
    confidence,
    data: {
      title,
      summary,
      status: findings.some((item) => item.level === "risk")
        ? "attention"
        : findings.some((item) => item.level === "review")
          ? "review"
          : "observed",
      findings,
      ...details,
    },
  });
}

function check(
  id: string,
  category: string,
  observation: "http" | "browser",
  analyze: (input: Readonly<Record<string, unknown>>) => CheckEvidence,
): CheckDefinition {
  return {
    id,
    version: "1.0.0",
    category,
    authorization: "deep",
    activity: "passive",
    modes: ["verified_deep_audit"],
    budget: {},
    requiredObservations: [observation],
    timeoutMs: 2_000,
    remediation: null,
    async analyze(input, signal) {
      if (signal.aborted) throw new Error("Deep analysis aborted");
      return [analyze(input)];
    },
  };
}

function httpObservation(
  input: Readonly<Record<string, unknown>>,
): HttpProbeResult {
  return input.http as HttpProbeResult;
}

function browserObservation(
  input: Readonly<Record<string, unknown>>,
): BrowserRuntimeObservation {
  return input.browser as BrowserRuntimeObservation;
}

function header(headers: Record<string, string>, name: string): string | null {
  return headers[name]?.slice(0, 8192) ?? null;
}

export function parseCsp(policy: string): Record<string, string[]> {
  const directives: Record<string, string[]> = Object.create(null) as Record<
    string,
    string[]
  >;
  for (const clause of policy.slice(0, 8192).split(";")) {
    const tokens = clause.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    if (
      name &&
      /^[a-z][a-z0-9-]*$/.test(name) &&
      !Object.hasOwn(directives, name)
    ) {
      directives[name] = tokens.slice(0, 40);
    }
  }
  return directives;
}

export function createHttpCatalogChecks(): CheckDefinition[] {
  return [
    check("deep-tls", "tls", "http", (input) => {
      const http = httpObservation(input);
      const findings: Finding[] = [];
      if (!http.ok) {
        findings.push({
          code: "tls-or-http-connection-error",
          level: "review",
          summary: "La connexion HTTP/TLS n'a pas abouti.",
          recommendation:
            "Vérifier l'erreur de connexion avant de conclure sur TLS.",
          observed: http.error.code,
        });
        return evidence(
          "deep-tls",
          "TLS avancé",
          "Connexion non établie",
          findings,
          {
            errorKind: http.error.kind,
          },
          0.8,
        );
      }
      const final = new URL(http.finalUrl);
      if (final.protocol !== "https:") {
        findings.push({
          code: "http-final-target",
          level: "risk",
          summary: "La réponse finale est servie sans HTTPS.",
          recommendation:
            "Servir le site sur HTTPS et rediriger HTTP vers HTTPS.",
        });
      }
      const tls = http.tls;
      const cert = tls?.certificate;
      if (tls?.protocol && /^(SSL|TLSv1(?:\.0|\.1)?$)/i.test(tls.protocol)) {
        findings.push({
          code: "legacy-tls-protocol",
          level: "risk",
          summary: "Le protocole TLS négocié est ancien.",
          recommendation: "Autoriser uniquement TLS 1.2 et 1.3.",
          observed: tls.protocol,
        });
      }
      const expiresAt = tls?.validTo ? Date.parse(tls.validTo) : NaN;
      if (Number.isFinite(expiresAt)) {
        const days = Math.floor((expiresAt - Date.now()) / 86_400_000);
        if (days < 0 || days <= 30) {
          findings.push({
            code: days < 0 ? "certificate-expired" : "certificate-expiring",
            level: days < 0 ? "risk" : "review",
            summary:
              days < 0
                ? "Le certificat est expiré."
                : "Le certificat expire bientôt.",
            recommendation: "Renouveler le certificat et vérifier la chaîne.",
            observed: days,
          });
        }
      }
      if (cert?.hostnameMatch === false || cert?.authorized === false) {
        findings.push({
          code: "certificate-validation-error",
          level: "risk",
          summary: "Le certificat ou son nom d'hôte ne valide pas.",
          recommendation: "Corriger le certificat et sa chaîne de confiance.",
          observed: cert.authorizationError,
        });
      }
      const upgraded = http.redirects.some(
        (item) => item.from.startsWith("http:") && item.to.startsWith("https:"),
      );
      return evidence(
        "deep-tls",
        "TLS avancé",
        tls
          ? `TLS ${tls.protocol ?? "inconnu"} observé.`
          : "Aucune session TLS observée.",
        findings,
        {
          finalProtocol: final.protocol,
          httpToHttpsObserved:
            upgraded ||
            http.finalUrl.startsWith("http:") ||
            http.redirects.some((item) => item.from.startsWith("http:"))
              ? upgraded
              : null,
          redirectAssessment:
            http.finalUrl.startsWith("https:") && http.redirects.length === 0
              ? "HTTP origin not probed outside verified scope"
              : "observed redirects only",
          protocol: tls?.protocol ?? null,
          cipher: tls?.cipher ?? null,
          validFrom: tls?.validFrom ?? null,
          validTo: tls?.validTo ?? null,
          certificate: cert ?? null,
          redirects: http.redirects,
        },
      );
    }),
    check("deep-security-headers", "headers", "http", (input) => {
      const http = httpObservation(input);
      const headers = http.ok ? http.headers : {};
      const findings: Finding[] = [];
      const inspected = [
        "strict-transport-security",
        "content-security-policy",
        "content-security-policy-report-only",
        "x-content-type-options",
        "referrer-policy",
        "permissions-policy",
        "x-frame-options",
        "cross-origin-opener-policy",
        "cross-origin-resource-policy",
        "cross-origin-embedder-policy",
        "cache-control",
        "server",
        "x-powered-by",
      ].map((name) => ({
        name,
        value: header(headers, name),
        present: header(headers, name) !== null,
      }));
      if (http.ok) {
        const https = http.finalUrl.startsWith("https:");
        const hsts = header(headers, "strict-transport-security");
        if (https && !hsts)
          findings.push({
            code: "hsts-absent",
            level: "review",
            summary: "HSTS absent sur HTTPS.",
            recommendation:
              "Définir Strict-Transport-Security après validation du périmètre HTTPS.",
          });
        const maxAge = /(?:^|;)\s*max-age\s*=\s*(\d+)/i.exec(hsts ?? "");
        if (hsts && (!maxAge || Number(maxAge[1]) < 15_552_000))
          findings.push({
            code: "hsts-weak",
            level: "review",
            summary: "Durée HSTS inférieure à 180 jours ou invalide.",
            recommendation: "Définir un max-age adapté.",
            observed: hsts,
          });
        const nosniff = header(headers, "x-content-type-options");
        if (!nosniff)
          findings.push({
            code: "nosniff-absent",
            level: "review",
            summary: "X-Content-Type-Options absent.",
            recommendation: "Ajouter nosniff.",
          });
        else if (nosniff.trim().toLowerCase() !== "nosniff")
          findings.push({
            code: "nosniff-invalid",
            level: "review",
            summary: "X-Content-Type-Options n'est pas nosniff.",
            recommendation: "Définir la valeur nosniff.",
            observed: nosniff,
          });
        const referrer = header(headers, "referrer-policy");
        if (referrer && /(?:^|,)\s*unsafe-url\s*(?:,|$)/i.test(referrer))
          findings.push({
            code: "referrer-policy-unsafe-url",
            level: "review",
            summary: "Referrer-Policy peut transmettre l'URL complète.",
            recommendation:
              "Choisir une politique qui limite les informations transmises.",
            observed: referrer,
          });
        const frame = header(headers, "x-frame-options");
        if (frame && !/^(deny|sameorigin)$/i.test(frame.trim()))
          findings.push({
            code: "x-frame-options-invalid",
            level: "review",
            summary: "X-Frame-Options a une valeur non standard.",
            recommendation:
              "Utiliser DENY ou SAMEORIGIN, ou une directive frame-ancestors adaptée.",
            observed: frame,
          });
        const permissions = header(headers, "permissions-policy");
        if (permissions && /=\s*\*/.test(permissions))
          findings.push({
            code: "permissions-policy-wildcard",
            level: "review",
            summary:
              "Permissions-Policy autorise une fonctionnalité pour toute origine.",
            recommendation: "Limiter la liste des origines autorisées.",
            observed: permissions,
          });
        if (!header(headers, "content-security-policy"))
          findings.push({
            code: "csp-absent",
            level: "review",
            summary: "CSP appliquée absente.",
            recommendation:
              "Déployer une CSP adaptée en partant d'un mode rapport.",
          });
        if (
          http.cookies?.length &&
          /(?:^|,)\s*public\b/i.test(header(headers, "cache-control") ?? "")
        )
          findings.push({
            code: "public-cache-with-cookies",
            level: "review",
            summary:
              "Une réponse avec Set-Cookie est déclarée publiquement cacheable.",
            recommendation:
              "Vérifier si cette réponse peut être mise en cache partagé sans données personnalisées.",
          });
        for (const name of ["server", "x-powered-by"]) {
          if (header(headers, name))
            findings.push({
              code: `${name}-exposed`,
              level: "information",
              summary: `${name} est exposé.`,
              recommendation: null,
              observed: header(headers, name),
            });
        }
      }
      return evidence(
        "deep-security-headers",
        "En-têtes de sécurité",
        `${inspected.filter((item) => item.present).length} en-têtes observés.`,
        findings,
        { headers: inspected },
      );
    }),
    check("deep-csp", "csp", "http", (input) => {
      const http = httpObservation(input);
      const headers = http.ok ? http.headers : {};
      const applied = header(headers, "content-security-policy");
      const reportOnly = header(headers, "content-security-policy-report-only");
      const directives = applied ? parseCsp(applied) : {};
      const findings: Finding[] = [];
      if (applied) {
        const scripts =
          directives["script-src"] ?? directives["default-src"] ?? [];
        if (scripts.length === 0)
          findings.push({
            code: "csp-script-src-unrestricted",
            level: "review",
            summary: "Aucune restriction effective des scripts n'est observée.",
            recommendation:
              "Définir script-src ou default-src avec des sources explicites.",
          });
        for (const [token, code] of [
          ["'unsafe-inline'", "unsafe-inline"],
          ["'unsafe-eval'", "unsafe-eval"],
          ["*", "wildcard-source"],
          ["data:", "data-source"],
          ...(http.ok && http.finalUrl.startsWith("https:")
            ? [["http:", "http-source"] as const]
            : []),
        ] as const) {
          if (scripts.includes(token))
            findings.push({
              code: `csp-script-${code}`,
              level: "review",
              summary: `script-src autorise ${token}.`,
              recommendation:
                "Restreindre les sources de scripts après vérification des usages.",
              observed: token,
            });
        }
        if (!directives["default-src"])
          findings.push({
            code: "csp-default-src-absent",
            level: "review",
            summary: "default-src est absent.",
            recommendation: "Définir un repli explicite.",
          });
        for (const name of ["object-src", "base-uri", "frame-ancestors"]) {
          if (!directives[name])
            findings.push({
              code: `csp-${name}-absent`,
              level: "review",
              summary: `${name} est absent.`,
              recommendation: "Définir cette directive selon le besoin réel.",
            });
        }
        if (directives["object-src"]?.some((item) => item !== "'none'"))
          findings.push({
            code: "csp-object-src-permissive",
            level: "review",
            summary: "object-src n'est pas limité à 'none'.",
            recommendation:
              "Limiter object-src à 'none' si aucun plugin n'est requis.",
          });
      }
      const allTokens = Object.values(directives).flat();
      return evidence(
        "deep-csp",
        "Politique CSP",
        applied
          ? "CSP appliquée analysée."
          : reportOnly
            ? "CSP en mode rapport uniquement."
            : "Aucune CSP observée.",
        findings,
        {
          applied: Boolean(applied),
          reportOnly: Boolean(reportOnly),
          directives,
          nonceObserved: allTokens.some((item) => item.startsWith("'nonce-")),
          hashObserved: allTokens.some((item) =>
            /^'(sha256|sha384|sha512)-/.test(item),
          ),
          reporting: ["report-uri", "report-to"].filter(
            (name) => name in directives,
          ),
        },
      );
    }),
    check("deep-cookies", "cookies", "http", (input) => {
      const http = httpObservation(input);
      const collected: ProbeCookie[] = [
        ...(http.ok ? (http.cookies ?? []) : []),
        ...((input.browser as BrowserRuntimeObservation | undefined)?.deep
          ?.cookies ?? []),
      ];
      const cookies = [
        ...new Map(
          collected.map((item) => [JSON.stringify(item), item]),
        ).values(),
      ];
      const findings: Finding[] = [];
      for (const cookie of cookies) {
        const sensitive =
          /session|auth|token|jwt|(?:^|[_-])sid(?:$|[_-])/i.test(cookie.name);
        if (
          cookie.name.startsWith("__Host-") &&
          (!cookie.secure || cookie.domain !== null || cookie.path !== "/")
        )
          findings.push({
            code: "host-prefix-invalid",
            level: "risk",
            summary: `Préfixe __Host- incohérent pour ${cookie.name}.`,
            recommendation: "Exiger Secure, Path=/ et aucun Domain.",
          });
        if (cookie.name.startsWith("__Secure-") && !cookie.secure)
          findings.push({
            code: "secure-prefix-invalid",
            level: "risk",
            summary: `Préfixe __Secure- incohérent pour ${cookie.name}.`,
            recommendation: "Exiger Secure.",
          });
        if (sensitive && !cookie.secure)
          findings.push({
            code: "sensitive-cookie-without-secure",
            level: "review",
            summary: `Cookie potentiellement sensible sans Secure : ${cookie.name}.`,
            recommendation: "Ajouter Secure si ce cookie porte une session.",
          });
        if (sensitive && !cookie.httpOnly)
          findings.push({
            code: "sensitive-cookie-without-httponly",
            level: "review",
            summary: `Cookie potentiellement sensible sans HttpOnly : ${cookie.name}.`,
            recommendation:
              "Ajouter HttpOnly si JavaScript n'a pas besoin de ce cookie.",
          });
        if (sensitive && !cookie.sameSite)
          findings.push({
            code: "sensitive-cookie-without-samesite",
            level: "review",
            summary: `Cookie potentiellement sensible sans SameSite explicite : ${cookie.name}.`,
            recommendation:
              "Définir SameSite selon les flux intersites requis.",
          });
        if (
          cookie.sameSite &&
          !["strict", "lax", "none"].includes(cookie.sameSite.toLowerCase())
        )
          findings.push({
            code: "samesite-invalid",
            level: "review",
            summary: `SameSite a une valeur non reconnue pour ${cookie.name}.`,
            recommendation: "Utiliser Strict, Lax ou None.",
            observed: cookie.sameSite,
          });
        if (cookie.sameSite?.toLowerCase() === "none" && !cookie.secure)
          findings.push({
            code: "samesite-none-without-secure",
            level: "risk",
            summary: `SameSite=None sans Secure : ${cookie.name}.`,
            recommendation: "Ajouter Secure.",
          });
      }
      return evidence(
        "deep-cookies",
        "Cookies",
        `${cookies.length} cookies observés sans stocker leurs valeurs.`,
        findings,
        { cookies },
        0.9,
      );
    }),
  ];
}

export function createBrowserCatalogChecks(): CheckDefinition[] {
  return [
    check("deep-resources", "resources", "browser", (input) => {
      const browser = browserObservation(input);
      const resources = browser.deep?.resources ?? [];
      const findings: Finding[] = [];
      for (const resource of resources) {
        if (
          browser.finalUrl.startsWith("https:") &&
          resource.url.startsWith("http:")
        )
          findings.push({
            code: "mixed-content-resource",
            level: "review",
            summary: `Ressource HTTP depuis une page HTTPS : ${resource.url}.`,
            recommendation: "Servir la ressource en HTTPS.",
          });
        if (resource.contentLength && resource.contentLength > 1_000_000)
          findings.push({
            code: "large-resource",
            level: "information",
            summary: `Ressource déclarée volumineuse : ${resource.url}.`,
            recommendation: "Vérifier si la taille est nécessaire.",
            observed: resource.contentLength,
          });
      }
      return evidence(
        "deep-resources",
        "Ressources de page",
        `${resources.length} ressources observées.`,
        findings,
        {
          resources,
          thirdPartyCount: resources.filter((item) => !item.inScope).length,
          thirdPartyOrigins: [
            ...new Set(
              resources
                .filter((item) => !item.inScope)
                .map((item) => new URL(item.url).origin),
            ),
          ].slice(0, 40),
          blockedCount: resources.filter((item) => item.blocked).length,
          excludedThirdPartyRequests:
            browser.deep?.excludedThirdPartyRequests ?? 0,
          consoleWarnings: browser.deep?.consoleWarnings ?? [],
          pageErrors: browser.deep?.pageErrors ?? [],
        },
        0.85,
      );
    }),
    check("deep-endpoints", "endpoints", "browser", (input) => {
      const browser = browserObservation(input);
      const discovered = browser.deep?.endpoints ?? [];
      const http = input.http as HttpProbeResult | undefined;
      const redirects = http?.redirects ?? [];
      const redirectEndpoints = redirects.flatMap((item) => [
        {
          url: item.from,
          source: "http-redirect-source",
          method: "GET",
          inScope: true,
          statusCode: item.statusCode,
        },
        {
          url: item.to,
          source: "http-redirect-target",
          method: "GET",
          inScope: true,
          statusCode: null,
        },
      ]);
      const endpoints = [...discovered, ...redirectEndpoints]
        .slice(0, 120)
        .map((item) => ({
          ...item,
          origin: new URL(item.url).origin,
          relation: item.inScope ? "in-scope" : "third-party",
        }));
      return evidence(
        "deep-endpoints",
        "Endpoints observés",
        `${endpoints.length} endpoints découverts sans exploration par dictionnaire.`,
        [],
        { endpoints },
        0.85,
      );
    }),
    check("deep-forms", "forms", "browser", (input) => {
      const browser = browserObservation(input);
      const forms = browser.deep?.forms ?? [];
      const findings: Finding[] = [];
      for (const form of forms) {
        if (form.method === "POST" && form.action.startsWith("http:"))
          findings.push({
            code: "form-post-over-http",
            level: "risk",
            summary: `Formulaire POST non chiffré : ${form.action}.`,
            recommendation: "Utiliser HTTPS pour l'action du formulaire.",
          });
        if (form.passwordFields > 0 && !form.inScope)
          findings.push({
            code: "password-form-third-party",
            level: "review",
            summary: `Formulaire avec mot de passe vers une origine tierce : ${form.action}.`,
            recommendation: "Vérifier l'origine et le contrat du fournisseur.",
          });
      }
      return evidence(
        "deep-forms",
        "Formulaires",
        `${forms.length} formulaires observés sans soumission.`,
        findings,
        { forms },
        0.9,
      );
    }),
    check("deep-browser-meta", "browser", "browser", (input) => {
      const browser = browserObservation(input);
      const findings: Finding[] = [];
      const origin = new URL(browser.finalUrl).origin;
      for (const item of browser.deep?.sri ?? []) {
        if (new URL(item.url).origin !== origin && !item.integrityPresent)
          findings.push({
            code: "cross-origin-resource-without-sri",
            level: "information",
            summary: `Ressource tierce sans SRI observée : ${item.url}.`,
            recommendation:
              "Évaluer SRI si la ressource est versionnée et stable.",
          });
      }
      return evidence(
        "deep-browser-meta",
        "Métadonnées navigateur",
        "Métadonnées et erreurs de la page principale.",
        findings,
        {
          meta: browser.deep?.meta ?? [],
          iframeSandboxes: browser.deep?.iframeSandboxes ?? [],
          sri: browser.deep?.sri ?? [],
          pageErrors: browser.deep?.pageErrors ?? [],
          consoleWarnings: browser.deep?.consoleWarnings ?? [],
        },
        0.85,
      );
    }),
  ];
}
