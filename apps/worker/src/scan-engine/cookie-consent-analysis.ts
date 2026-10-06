import type { CookieConsentObservation } from "./cookie-consent-observation.js";

type CookiePurpose = "advertising" | "analytics" | "session-replay" | "unknown";
type CookieClassification = {
  purpose: CookiePurpose;
  provider: string | null;
  source: string | null;
};

const signatures: Array<CookieClassification & { name: RegExp }> = [
  {
    name: /^_ga(?:_[A-Z0-9]{4,})?$/,
    purpose: "analytics",
    provider: "Google Analytics",
    source: "https://support.google.com/analytics/answer/11397207",
  },
  {
    name: /^_gcl_[A-Za-z0-9]+$/,
    purpose: "advertising",
    provider: "Google Ads",
    source: "https://policies.google.com/technologies/cookies?hl=fr",
  },
  {
    name: /^li_fat_id$/,
    purpose: "advertising",
    provider: "LinkedIn Ads",
    source:
      "https://learn.microsoft.com/en-us/linkedin/marketing/conversions/enabling-first-party-cookies",
  },
  {
    name: /^_cl(?:ck|sk)$/,
    purpose: "session-replay",
    provider: "Microsoft Clarity",
    source:
      "https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-cookies",
  },
];

/** Names are purpose hints, never proof of a vendor or of a consent exemption. */
export function classifyConsentCookie(name: string): CookieClassification {
  const signature = signatures.find((item) => item.name.test(name));
  return signature
    ? {
        purpose: signature.purpose,
        provider: signature.provider,
        source: signature.source,
      }
    : { purpose: "unknown", provider: null, source: null };
}

export function assessCookieConsent(
  observation: CookieConsentObservation | undefined,
  excludedThirdPartyRequests: number,
) {
  const findings: Array<{
    code: string;
    level: "review";
    summary: string;
    recommendation: string;
    observed: string;
  }> = [];
  const cookies = (observation?.cookies ?? []).map((cookie) => ({
    ...cookie,
    ...classifyConsentCookie(cookie.name),
  }));
  for (const cookie of cookies) {
    if (cookie.purpose === "unknown") continue;
    findings.push({
      code: "cookie-tracker-before-consent",
      level: "review",
      summary: `Cookie associé à ${cookie.provider} observé avant toute interaction : ${cookie.name}.`,
      recommendation:
        "Confirmer la finalité de ce cookie et, s'il n'est pas exempté, empêcher son dépôt jusqu'au consentement préalable. Son nom constitue un indice, pas une conclusion juridique.",
      observed: `${cookie.name} · ${cookie.domain}${cookie.path}`,
    });
  }
  const status = observation?.status ?? "unavailable";
  const summary =
    status === "unavailable"
      ? "Observation avant interaction indisponible : aucune conclusion sur le consentement."
      : `${cookies.length} cookie(s) accepté(s) observé(s) sans interaction, dont ${findings.length} associé(s) à des traceurs connus.`;
  return {
    summary,
    findings,
    details: {
      method: "fresh-context-no-interaction",
      status,
      requestedWindowMs: observation?.requestedWindowMs ?? 3_000,
      observedWindowMs: observation?.observedWindowMs ?? 0,
      sampleCount: observation?.sampleCount ?? 0,
      reasons: observation?.reasons ?? ["browser-unavailable"],
      cookies,
      knownTrackerCount: findings.length,
      unknownPurposeCount: cookies.length - findings.length,
      excludedThirdPartyRequests,
      limitations: [
        "Observation de la page d'arrivée en session vierge, sans clic ni consentement donné par le scanner.",
        "Les noms de cookies donnent des indices de finalité ; les exemptions éventuelles doivent être vérifiées.",
        "Les ressources de domaines tiers sont bloquées : leurs cookies et ceux de scripts non chargés ne sont pas évalués.",
        "Les cookies après la fenêtre d'observation, entre deux relevés et les autres stockages ou traceurs ne sont pas évalués.",
      ],
    },
  };
}
