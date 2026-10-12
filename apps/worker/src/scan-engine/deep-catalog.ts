import {
  safeHeaderValue,
  type HttpProbeResult,
  type ProbeCookie,
} from "../http-probe.js";
import type { BrowserRuntimeObservation } from "../browser-runtime.js";
import type { CheckDefinition } from "./check-registry.js";
import { createEvidence, type CheckEvidence } from "./evidence.js";
import { assessCookieConsent } from "./cookie-consent-analysis.js";
import {
  allowsArbitraryInline,
  effectiveDirective,
  effectiveReferrerPolicy,
  hasNonceOrHash,
  observedCspPolicies,
  restrictsFraming,
  wildcardPermissions,
} from "./deep-policy-analysis.js";
export { parseCsp } from "./deep-policy-analysis.js";

function checkVersion(id: string): string {
  if (id === "deep-security-headers" || id === "deep-csp") return "2.0.0";
  if (id === "deep-cookies") return "2.0.0";
  return "1.0.0";
}

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
    checkVersion: checkVersion(id),
    classification: "observation",
    confidence,
    data: {
      title,
      summary,
      status:
        details.coverage === "unavailable"
          ? "unavailable"
          : details.coverage === "limited"
            ? "limited"
            : findings.some((item) => item.level === "risk")
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
    version: checkVersion(id),
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
  const value = headers[name];
  return value === undefined ? null : safeHeaderValue(name, value);
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
      if (!http.ok)
        return evidence(
          "deep-security-headers",
          "En-têtes de sécurité",
          "En-têtes non évalués : réponse HTTP indisponible.",
          [],
          {
            httpObserved: false,
            coverage: "unavailable",
            errorKind: http.error.kind,
          },
          0.8,
        );
      const headers = http.headers;
      const findings: Finding[] = [];
      const policies = observedCspPolicies(http);
      const hasFrameAncestors = policies.enforced.some((policy) =>
        Object.hasOwn(policy, "frame-ancestors"),
      );
      const frameProtected =
        !policies.limited && policies.enforced.some(restrictsFraming);
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
        "clear-site-data",
        "cache-control",
        "server",
        "x-powered-by",
      ].map((name) => ({
        name,
        value: header(headers, name),
        present: header(headers, name) !== null,
      }));
      const https = http.finalUrl.startsWith("https:");
      const hsts = header(headers, "strict-transport-security");
      if (https && !hsts)
        findings.push({
          code: "hsts-absent",
          level: "information",
          summary: "HSTS non observé sur cette réponse HTTPS.",
          recommendation:
            "Envisager HSTS après validation du périmètre HTTPS concerné.",
        });
      else if (https && hsts) {
        const ages = [
          ...hsts.matchAll(
            /(?:^|;)\s*max-age\s*=\s*(?:"(\d+)"|(\d+))\s*(?=;|$)/gi,
          ),
        ];
        const declarations = [...hsts.matchAll(/(?:^|;)\s*max-age\s*=/gi)];
        const age =
          ages.length === 1 && declarations.length === 1
            ? Number(ages[0]![1] ?? ages[0]![2])
            : NaN;
        if (!Number.isSafeInteger(age) || age < 0)
          findings.push({
            code: "hsts-weak",
            level: "review",
            summary: "HSTS ne contient pas un max-age unique et exploitable.",
            recommendation:
              "Définir un unique max-age entier positif, sur HTTPS.",
            observed: hsts,
          });
        else if (age === 0 || age < 15_552_000)
          findings.push({
            code: "hsts-weak",
            level: "review",
            summary:
              age === 0
                ? "HSTS est désactivé (max-age=0)."
                : "Durée HSTS inférieure à 180 jours.",
            recommendation:
              "Choisir une durée adaptée après vérification du périmètre HTTPS.",
            observed: age,
          });
      }
      const nosniff = header(headers, "x-content-type-options");
      if (!nosniff)
        findings.push({
          code: "nosniff-absent",
          level: "information",
          summary: "X-Content-Type-Options non observé.",
          recommendation: "Envisager nosniff sur les réponses pertinentes.",
        });
      else if (nosniff.split(",")[0]?.trim().toLowerCase() !== "nosniff")
        findings.push({
          code: "nosniff-invalid",
          level: "review",
          summary:
            "X-Content-Type-Options n'a pas la valeur exploitable nosniff.",
          recommendation: "Définir exactement nosniff.",
          observed: nosniff,
        });
      const referrer = header(headers, "referrer-policy");
      const effectiveReferrer = referrer
        ? effectiveReferrerPolicy(referrer)
        : null;
      if (referrer && !effectiveReferrer)
        findings.push({
          code: "referrer-policy-unrecognized",
          level: "review",
          summary: "Aucune valeur reconnue de Referrer-Policy.",
          recommendation:
            "Utiliser une valeur reconnue et vérifier sa position finale.",
          observed: referrer,
        });
      else if (effectiveReferrer === "unsafe-url")
        findings.push({
          code: "referrer-policy-unsafe-url",
          level: "review",
          summary:
            "La dernière valeur reconnue transmet potentiellement l'URL complète.",
          recommendation:
            "Choisir une politique limitant les informations transmises.",
          observed: effectiveReferrer,
        });
      const frame = header(headers, "x-frame-options");
      const validFrame = frame
        ? /^(deny|sameorigin)$/i.test(frame.trim())
        : false;
      if (!frameProtected && !policies.limited) {
        if (frame && !validFrame && !hasFrameAncestors)
          findings.push({
            code: "x-frame-options-invalid",
            level: "review",
            summary: "X-Frame-Options n'a pas une valeur reconnue.",
            recommendation:
              "Utiliser DENY ou SAMEORIGIN, ou une CSP frame-ancestors adaptée.",
            observed: frame,
          });
        else if (!validFrame || hasFrameAncestors)
          findings.push({
            code: "framing-protection-review",
            level: "review",
            summary: "Protection contre l'intégration en frame non démontrée.",
            recommendation:
              "Vérifier le besoin d'intégration, puis définir frame-ancestors dans une CSP appliquée ou X-Frame-Options si nécessaire.",
            observed: hasFrameAncestors
              ? "frame-ancestors permissif ou non reconnu"
              : "aucune protection reconnue",
          });
      }
      const permissions = header(headers, "permissions-policy");
      const wildcardFeatures = permissions
        ? wildcardPermissions(permissions)
        : [];
      if (wildcardFeatures.length > 0)
        findings.push({
          code: "permissions-policy-wildcard",
          level: "review",
          summary:
            "Permissions-Policy autorise des fonctionnalités pour toute origine : " +
            wildcardFeatures.join(", ") +
            ".",
          recommendation:
            "Vérifier l'usage de ces fonctionnalités, puis limiter les origines si nécessaire.",
          observed: wildcardFeatures.join(", "),
        });
      for (const [name, allowed] of [
        [
          "cross-origin-opener-policy",
          [
            "unsafe-none",
            "same-origin",
            "same-origin-allow-popups",
            "noopener-allow-popups",
          ],
        ],
        [
          "cross-origin-embedder-policy",
          ["unsafe-none", "require-corp", "credentialless"],
        ],
        [
          "cross-origin-resource-policy",
          ["same-origin", "same-site", "cross-origin"],
        ],
      ] as const) {
        const value = header(headers, name);
        if (
          value &&
          !allowed.some(
            (item) =>
              item ===
              (name === "cross-origin-resource-policy"
                ? value.trim()
                : value.split(";")[0]?.trim()),
          )
        )
          findings.push({
            code: name + "-invalid",
            level: "review",
            summary: name + " a une valeur non reconnue.",
            recommendation:
              "Choisir une valeur valide selon le contexte d'isolation souhaité.",
            observed: value,
          });
      }
      const clearSiteData = header(headers, "clear-site-data");
      if (
        clearSiteData &&
        !/^(\s*"(?:cache|cookies|storage|executionContexts|prefetchCache|prerenderCache|\*)"\s*)(,\s*"(?:cache|cookies|storage|executionContexts|prefetchCache|prerenderCache|\*)"\s*)*$/i.test(
          clearSiteData,
        )
      )
        findings.push({
          code: "clear-site-data-invalid",
          level: "review",
          summary: "Clear-Site-Data présent avec une syntaxe non reconnue.",
          recommendation:
            "Utiliser des directives entre guillemets sur les réponses de purge pertinentes.",
          observed: clearSiteData,
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
      for (const name of ["server", "x-powered-by"])
        if (header(headers, name))
          findings.push({
            code: name + "-exposed",
            level: "information",
            summary: name + " est exposé.",
            recommendation: null,
            observed: header(headers, name),
          });
      return evidence(
        "deep-security-headers",
        "En-têtes de sécurité",
        String(inspected.filter((item) => item.present).length) +
          " en-têtes observés.",
        findings,
        {
          httpObserved: true,
          coverage: policies.limited ? "limited" : "observed",
          pageUrl: http.finalUrl,
          headers: inspected,
          effectiveReferrerPolicy:
            effectiveReferrer ??
            (referrer ? "unrecognized" : "browser-default"),
          frameProtection: frameProtected
            ? "csp-frame-ancestors"
            : validFrame && !hasFrameAncestors
              ? "x-frame-options"
              : "review",
        },
      );
    }),
    check("deep-csp", "csp", "http", (input) => {
      const http = httpObservation(input);
      if (!http.ok)
        return evidence(
          "deep-csp",
          "Politique CSP",
          "CSP non évaluée : réponse HTTP indisponible.",
          [],
          {
            httpObserved: false,
            coverage: "unavailable",
            applied: false,
            reportOnly: false,
          },
          0.8,
        );
      const policies = observedCspPolicies(http);
      const applied = policies.enforced.length > 0;
      const reportOnly = policies.reportOnly.length > 0;
      const findings: Finding[] = [];
      if (policies.limited)
        findings.push({
          code: "csp-policy-limited",
          level: "information",
          summary:
            "Occurrences CSP incomplètes ou tronquées : effet global non conclu.",
          recommendation: "Vérifier les champs CSP complets côté serveur.",
        });
      else if (!applied)
        findings.push({
          code: "csp-absent",
          level: "review",
          summary: "Aucune CSP appliquée n'a été observée.",
          recommendation:
            "Définir une politique adaptée, la valider en mode rapport puis l'appliquer.",
        });
      else {
        const elementSources = policies.enforced.map((policy) =>
          effectiveDirective(
            policy,
            "script-src-elem",
            "script-src",
            "default-src",
          ),
        );
        const attributeSources = policies.enforced.map((policy) =>
          effectiveDirective(
            policy,
            "script-src-attr",
            "script-src",
            "default-src",
          ),
        );
        const evalSources = policies.enforced.map((policy) =>
          effectiveDirective(policy, "script-src", "default-src"),
        );
        if (elementSources.every((sources) => sources === null))
          findings.push({
            code: "csp-script-src-unrestricted",
            level: "review",
            summary: "Aucune restriction effective des scripts n'est observée.",
            recommendation:
              "Définir script-src-elem, script-src ou default-src selon les usages.",
          });
        const inlineContexts = [
          elementSources.every(
            (sources) => sources === null || allowsArbitraryInline(sources),
          ) &&
          elementSources.some((sources) => sources?.includes("'unsafe-inline'"))
            ? "éléments script"
            : null,
          attributeSources.every(
            (sources) => sources === null || allowsArbitraryInline(sources),
          ) &&
          attributeSources.some((sources) =>
            sources?.includes("'unsafe-inline'"),
          )
            ? "attributs de script"
            : null,
        ].filter((item): item is string => item !== null);
        if (inlineContexts.length)
          findings.push({
            code: "csp-script-unsafe-inline",
            level: "review",
            summary:
              "La CSP permet du JavaScript inline sans nonce ni hash effectif.",
            recommendation:
              "Employer un nonce ou un hash, et éviter unsafe-inline pour ces contextes.",
            observed: inlineContexts.join(", "),
          });
        if (
          evalSources.every(
            (sources) => sources === null || sources.includes("'unsafe-eval'"),
          ) &&
          evalSources.some((sources) => sources?.includes("'unsafe-eval'"))
        )
          findings.push({
            code: "csp-script-unsafe-eval",
            level: "review",
            summary: "La CSP autorise unsafe-eval.",
            recommendation:
              "Retirer unsafe-eval après vérification des dépendances.",
            observed: "'unsafe-eval'",
          });
        for (const [token, code] of [
          ["*", "wildcard-source"],
          ["data:", "data-source"],
          ["http:", "http-source"],
        ] as const) {
          if (token === "http:" && !http.finalUrl.startsWith("https:"))
            continue;
          if (
            elementSources.every(
              (sources) =>
                sources === null ||
                (sources.includes(token) &&
                  !sources.includes("'strict-dynamic'")),
            ) &&
            elementSources.some((sources) => sources?.includes(token))
          )
            findings.push({
              code: "csp-script-" + code,
              level: "review",
              summary:
                "La restriction effective des scripts accepte " + token + ".",
              recommendation:
                "Restreindre les sources de scripts après vérification des usages.",
              observed: token,
            });
        }
        const objects = policies.enforced.map((policy) =>
          effectiveDirective(policy, "object-src", "default-src"),
        );
        if (
          objects.every(
            (sources) =>
              sources === null ||
              !(
                sources.length === 0 ||
                (sources.length === 1 && sources[0] === "'none'")
              ),
          )
        )
          findings.push({
            code: objects.every((sources) => sources === null)
              ? "csp-object-src-unrestricted"
              : "csp-object-src-permissive",
            level: "review",
            summary: "Les objets intégrés ne sont pas explicitement bloqués.",
            recommendation:
              "Définir object-src 'none' si aucun plugin n'est requis.",
          });
        if (
          policies.enforced.every((policy) => {
            const sources = effectiveDirective(policy, "base-uri");
            return (
              sources === null ||
              sources.includes("*") ||
              sources.includes("http:") ||
              sources.includes("https:")
            );
          })
        )
          findings.push({
            code: policies.enforced.every(
              (policy) => !Object.hasOwn(policy, "base-uri"),
            )
              ? "csp-base-uri-absent"
              : "csp-base-uri-permissive",
            level: "review",
            summary:
              "base-uri n'est pas restreint par une politique appliquée.",
            recommendation:
              "Définir base-uri selon les besoins des éléments base.",
          });
        if (
          policies.enforced.every((policy) => {
            const sources = effectiveDirective(policy, "form-action");
            return (
              sources === null ||
              sources.includes("*") ||
              sources.includes("http:") ||
              sources.includes("https:")
            );
          })
        )
          findings.push({
            code: policies.enforced.every(
              (policy) => !Object.hasOwn(policy, "form-action"),
            )
              ? "csp-form-action-absent"
              : "csp-form-action-permissive",
            level: "information",
            summary:
              "form-action n'est pas restreint par une politique appliquée.",
            recommendation:
              "Envisager form-action selon les destinations de formulaire autorisées.",
          });
      }
      const allTokens = policies.enforced.flatMap((policy) =>
        Object.values(policy).flat(),
      );
      return evidence(
        "deep-csp",
        "Politique CSP",
        policies.limited
          ? "CSP partiellement observée : interprétation limitée."
          : applied
            ? "CSP appliquée analysée."
            : reportOnly
              ? "CSP en mode rapport uniquement."
              : "Aucune CSP observée.",
        findings,
        {
          httpObserved: true,
          coverage: policies.limited ? "limited" : "observed",
          pageUrl: http.finalUrl,
          applied,
          reportOnly,
          policyCount: policies.enforced.length,
          reportOnlyPolicyCount: policies.reportOnly.length,
          directives: policies.enforced[0] ?? {},
          policies: policies.enforced,
          nonceObserved: allTokens.some((item) => item.startsWith("'nonce-")),
          hashObserved: allTokens.some((item) =>
            /^'(sha256|sha384|sha512)-/.test(item),
          ),
          strictDynamicWithNonceOrHash: policies.enforced.some((policy) => {
            const scripts = effectiveDirective(policy, "script-src");
            return (
              !!scripts?.includes("'strict-dynamic'") && hasNonceOrHash(scripts)
            );
          }),
          frameAncestorsEffective: policies.enforced.some(restrictsFraming),
          reporting: ["report-uri", "report-to"].filter((name) =>
            policies.enforced.some((policy) => name in policy),
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
      const cookieCollectionLimited =
        collected.length >= 120 || (http.ok && http.cookies?.length === 40);
      const cookies = [
        ...new Map(
          collected.slice(0, 120).map((item) => [JSON.stringify(item), item]),
        ).values(),
      ];
      const findings: Finding[] = [];
      for (const cookie of cookies.slice(0, 120)) {
        const likelySession =
          /(?:^|[_-])(?:session|auth|jwt|sid)(?:$|[_-])/i.test(cookie.name) &&
          !/csrf|xsrf|antiforgery/i.test(cookie.name);
        if (
          cookie.name.startsWith("__Host-") &&
          (!cookie.secure || cookie.domain !== null || cookie.path !== "/")
        )
          findings.push({
            code: "host-prefix-invalid",
            level: "risk",
            summary: "Préfixe __Host- incohérent pour " + cookie.name + ".",
            recommendation: "Exiger Secure, Path=/ et aucun Domain.",
          });
        if (cookie.name.startsWith("__Secure-") && !cookie.secure)
          findings.push({
            code: "secure-prefix-invalid",
            level: "risk",
            summary: "Préfixe __Secure- incohérent pour " + cookie.name + ".",
            recommendation: "Exiger Secure.",
          });
        if (
          likelySession &&
          http.ok &&
          http.finalUrl.startsWith("https:") &&
          !cookie.secure
        )
          findings.push({
            code: "sensitive-cookie-without-secure",
            level: "review",
            summary:
              "Cookie de rôle à confirmer sans Secure : " + cookie.name + ".",
            recommendation:
              "Si ce cookie porte une session, ajouter Secure ; confirmer d'abord sa finalité.",
          });
        if (
          cookie.sameSite &&
          !["strict", "lax", "none"].includes(cookie.sameSite.toLowerCase())
        )
          findings.push({
            code: "samesite-invalid",
            level: "review",
            summary:
              "SameSite a une valeur non reconnue pour " + cookie.name + ".",
            recommendation: "Utiliser Strict, Lax ou None.",
            observed: cookie.sameSite,
          });
        if (cookie.sameSite?.toLowerCase() === "none" && !cookie.secure)
          findings.push({
            code: "samesite-none-without-secure",
            level: "risk",
            summary: "SameSite=None sans Secure : " + cookie.name + ".",
            recommendation: "Ajouter Secure.",
          });
        const maxAgeSeconds =
          cookie.maxAge !== null && /^-?\d+$/.test(cookie.maxAge)
            ? Number(cookie.maxAge)
            : NaN;
        const expiryDays = cookie.expires
          ? (Date.parse(cookie.expires) - Date.now()) / 86_400_000
          : NaN;
        if (
          (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 400 * 86_400) ||
          (!Number.isFinite(maxAgeSeconds) &&
            Number.isFinite(expiryDays) &&
            expiryDays > 400)
        )
          findings.push({
            code: "cookie-long-duration",
            level: "review",
            summary:
              "Durée de cookie supérieure au seuil contextuel de 400 jours : " +
              cookie.name +
              ".",
            recommendation:
              "Vérifier la finalité et réduire la durée si elle n'est pas nécessaire.",
            observed: Number.isFinite(maxAgeSeconds)
              ? Math.round(maxAgeSeconds / 86_400)
              : Math.round(expiryDays),
          });
        if (http.ok && cookie.domain) {
          const domain = cookie.domain.replace(/^\./, "").toLowerCase();
          const host = new URL(http.finalUrl).hostname.toLowerCase();
          if (domain && host !== domain && host.endsWith("." + domain))
            findings.push({
              code: "cookie-broad-domain",
              level: "review",
              summary:
                "Cookie accessible à un domaine parent : " + cookie.name + ".",
              recommendation:
                "Vérifier si les sous-domaines ont besoin de ce cookie ; sinon omettre Domain.",
              observed: domain,
            });
        }
      }
      const browser = input.browser as BrowserRuntimeObservation | undefined;
      const consent = assessCookieConsent(
        browser?.deep?.cookieConsent,
        browser?.deep?.excludedThirdPartyRequests ?? 0,
      );
      return evidence(
        "deep-cookies",
        "Cookies et consentement",
        `${cookies.length} cookie(s) observé(s). ${http.ok ? "" : "Réponse HTTP indisponible. "}${consent.summary} Aucune valeur de cookie conservée.`,
        [...findings, ...consent.findings],
        {
          cookies,
          cookieConsent: consent.details,
          httpObserved: http.ok,
          coverage: !http.ok
            ? "unavailable"
            : cookieCollectionLimited
              ? "limited"
              : "observed",
          pageUrl: http.ok ? http.finalUrl : null,
          durationThresholdDays: 400,
          cookieRoleRequiresConfirmation: true,
        },
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
