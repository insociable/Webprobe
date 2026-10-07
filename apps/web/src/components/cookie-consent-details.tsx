function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

const purposeLabels: Record<string, string> = {
  advertising: "Indice publicitaire",
  analytics: "Indice de mesure d'audience",
  "session-replay": "Indice d'analyse du comportement",
  unknown: "Finalité à confirmer",
};

export function CookieConsentDetails({
  observation,
  observedAt,
}: {
  observation: unknown;
  observedAt?: Date;
}) {
  const data = record(observation);
  if (data?.method !== "fresh-context-no-interaction") return null;
  const unavailable = data.status !== "observed" && data.status !== "limited";
  const cookies = (Array.isArray(data.cookies) ? data.cookies : [])
    .map(record)
    .filter((cookie): cookie is Record<string, unknown> => cookie !== null)
    .slice(0, 120);
  const known = count(data.knownTrackerCount);
  const unknown = count(data.unknownPurposeCount);
  const reasons = Array.isArray(data.reasons) ? data.reasons : [];

  return (
    <div className="mt-4 rounded-md border border-[#303a50] bg-[#111827] p-4">
      <h5 className="text-base font-semibold text-white/80">
        Cookies avant toute interaction
      </h5>
      <p className="mt-2 text-sm leading-6 text-white/55">
        Session vierge, sans cliquer sur le bandeau. Relevés pendant{" "}
        {(count(data.observedWindowMs) / 1_000).toFixed(1)} s après le
        chargement initial. Les valeurs des cookies ne sont pas conservées.
      </p>
      {observedAt ? (
        <p className="mt-1 text-xs text-white/45">
          Contrôle démarré le{" "}
          {new Intl.DateTimeFormat("fr-FR", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "Europe/Paris",
          }).format(observedAt)}{" "}
          · Source : stockage cookies du navigateur de ce scan.
        </p>
      ) : null}
      {unavailable ? (
        <p className="mt-3 text-sm leading-6 text-amber-100 opacity-80">
          Observation indisponible. Le dépôt avant consentement n’a pas pu être
          évalué.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-6 text-white/65">
            {known > 0
              ? `${known} cookie(s) associé(s) à des traceurs connus, à vérifier ci-dessous.`
              : "Aucun cookie de traceur connu observé dans cette fenêtre."}
            {unknown > 0
              ? ` ${unknown} cookie(s) de finalité inconnue à examiner.`
              : ""}
          </p>
          {data.status === "limited" ? (
            <p className="mt-2 text-sm leading-6 text-amber-100 opacity-80">
              Observation limitée
              {reasons.includes("time-budget")
                ? " par le temps disponible"
                : ""}
              {reasons.includes("cookie-read-failed")
                ? " par un relevé indisponible"
                : ""}
              {reasons.includes("cookie-limit") ? " à 120 cookies" : ""}. Le
              résultat ne permet pas d’exclure d’autres dépôts.
            </p>
          ) : null}
          {cookies.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#303a50] text-white/45">
                    <th scope="col" className="py-2 pr-4">
                      Cookie et domaine
                    </th>
                    <th scope="col" className="py-2">
                      Source et portée de l’indice
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cookies.map((cookie, index) => {
                    const name =
                      typeof cookie.name === "string" ? cookie.name : "—";
                    const domain =
                      typeof cookie.domain === "string" ? cookie.domain : "—";
                    const purpose =
                      typeof cookie.purpose === "string"
                        ? cookie.purpose
                        : "unknown";
                    const provider =
                      typeof cookie.provider === "string"
                        ? cookie.provider
                        : null;
                    const firstObserved =
                      typeof cookie.firstObservedAfterLoadMs === "number"
                        ? cookie.firstObservedAfterLoadMs
                        : null;
                    return (
                      <tr
                        key={index}
                        className="border-b border-[#242d40] align-top"
                      >
                        <td className="py-3 pr-4">
                          <span className="break-all font-mono text-white/75">
                            {name}
                          </span>
                          <span className="mt-1 block break-all text-white/40">
                            {domain}
                          </span>
                          <span className="mt-1 block text-xs text-white/35">
                            {firstObserved !== null
                              ? `Premier relevé : +${(firstObserved / 1000).toFixed(1)} s après le chargement.`
                              : "Moment du relevé indisponible."}
                          </span>
                        </td>
                        <td className="py-3 text-white/60">
                          {purposeLabels[purpose] ?? purposeLabels.unknown}
                          <span className="mt-1 block text-xs text-white/40">
                            {provider
                              ? "Reconnu par une signature de nom ; finalité réelle à vérifier."
                              : "Aucune signature reconnue ; finalité inconnue."}
                          </span>
                          {provider ? (
                            <span className="mt-1 block text-white/40">
                              {provider}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
      <p className="mt-3 text-sm leading-6 text-white/45">
        Les noms donnent des indices, pas une conclusion juridique. Les
        exemptions de consentement doivent être vérifiées selon la finalité et
        la configuration.
      </p>
      <p className="mt-2 text-sm leading-6 text-white/45">
        Les domaines tiers restent bloqués
        {count(data.excludedThirdPartyRequests) > 0
          ? ` (${count(data.excludedThirdPartyRequests)} requête(s) exclue(s))`
          : ""}
        . Les scripts non chargés, les dépôts entre deux relevés ou plus
        tardifs, et les autres stockages ne sont pas évalués. Ce contrôle ne
        certifie pas la conformité du site.
      </p>
      <a
        href="https://www.cnil.fr/fr/cookies-et-autres-traceurs/que-dit-la-loi"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block text-sm font-semibold text-[#8793ff] underline underline-offset-4"
      >
        Règles et exemptions de consentement — CNIL
      </a>
    </div>
  );
}
