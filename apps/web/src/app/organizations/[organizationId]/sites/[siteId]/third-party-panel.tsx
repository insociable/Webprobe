import type { ThirdPartyRow } from "@/lib/third-party-service";
import { setThirdPartyDecisionAction } from "./third-party-actions";

const labels: Record<string, string> = {
  cloudflare: "Cloudflare",
  stripe: "Stripe",
  "google-analytics": "Google Analytics",
  plausible: "Plausible",
  sentry: "Sentry",
  posthog: "PostHog",
  intercom: "Intercom",
  hotjar: "Hotjar",
  vercel: "Vercel",
};
const missingLabels: Record<string, string> = {
  transfer: "Mécanisme de transfert",
  location: "Localisation",
  purpose: "Finalité",
  legalName: "Raison sociale",
  officialUrl: "Document officiel",
};

function value(text: string | null): string {
  return text || "Non renseigné";
}

export function ThirdPartyPanel({
  rows,
  organizationId,
  siteId,
  canManage,
}: {
  rows: ThirdPartyRow[];
  organizationId: string;
  siteId: string;
  canManage: boolean;
}) {
  const action = setThirdPartyDecisionAction.bind(null, organizationId, siteId);
  return (
    <section
      className="border-t border-[#242d40] py-9"
      aria-labelledby="third-parties-title"
    >
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-[#647188]">
        Services détectés
      </p>
      <h2 id="third-parties-title" className="mt-2 text-2xl font-semibold">
        Services tiers / RGPD
      </h2>
      <p className="mt-3 max-w-3xl text-base text-[#9aa6ba]">
        Une détection technique ne constitue pas une qualification juridique.
        Vérifiez les services réellement utilisés.
      </p>
      {rows.length === 0 ? (
        <p className="mt-5 text-[#9aa6ba]">
          Aucun service tiers détecté lors du dernier scan.
        </p>
      ) : (
        <div className="mt-6 grid gap-4">
          {rows.map((row) => (
            <article
              key={row.providerId}
              className="rounded-lg border border-[#303a50] bg-[#111827] p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold">
                  {labels[row.providerId]}
                </h3>
                <span className="text-sm text-[#aeb9cc]">
                  {row.confidence === "high"
                    ? "Confiance élevée"
                    : row.confidence === "medium"
                      ? "Confiance moyenne"
                      : "Non observé au dernier scan"}
                </span>
              </div>
              {row.evidence.length > 0 ? (
                <div className="mt-3 text-sm text-[#aeb9cc]">
                  <p>Preuves techniques :</p>
                  <ul className="ml-5 mt-1 list-disc">
                    {row.evidence.map((evidence) => (
                      <li key={evidence}>{evidence}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-3 text-sm text-[#aeb9cc]">
                Décision :{" "}
                {row.status === "pending"
                  ? "à confirmer"
                  : row.status === "confirmed"
                    ? "confirmé par votre organisation"
                    : "ignoré par votre organisation"}
              </p>
              {canManage ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {row.status !== "confirmed" ? (
                    <form action={action}>
                      <input
                        type="hidden"
                        name="providerId"
                        value={row.providerId}
                      />
                      <input type="hidden" name="status" value="confirmed" />
                      <button className="am-button-primary" type="submit">
                        Confirmer
                      </button>
                    </form>
                  ) : (
                    <form action={action}>
                      <input
                        type="hidden"
                        name="providerId"
                        value={row.providerId}
                      />
                      <input type="hidden" name="status" value="confirmed" />
                      <button className="am-button-secondary" type="submit">
                        Réessayer l’enrichissement
                      </button>
                    </form>
                  )}
                  {row.status !== "ignored" ? (
                    <form action={action}>
                      <input
                        type="hidden"
                        name="providerId"
                        value={row.providerId}
                      />
                      <input type="hidden" name="status" value="ignored" />
                      <button className="am-button-secondary" type="submit">
                        Ignorer
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
              {row.status === "confirmed" ? (
                row.provider ? (
                  <div className="mt-5 border-t border-[#303a50] pt-4 text-sm text-[#c0cadb]">
                    <p className="mb-3 text-xs uppercase tracking-wide text-[#9aa6ba]">
                      Informations réglementaires fournies par StackLégal
                    </p>
                    <p className="font-semibold">
                      {row.provider.name} — {value(row.provider.legalName)}
                    </p>
                    <dl className="mt-3 grid gap-2">
                      <div>
                        <dt className="font-medium">Finalité</dt>
                        <dd>{value(row.provider.purpose)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">Localisation</dt>
                        <dd>{value(row.provider.location)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">Transfert</dt>
                        <dd>
                          {row.provider.transfer.length
                            ? row.provider.transfer.join(", ")
                            : "Non renseigné"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium">Statut DPF</dt>
                        <dd>{value(row.provider.dpfStatus)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">Dernière vérification</dt>
                        <dd>{value(row.provider.lastVerified)}</dd>
                      </div>
                    </dl>
                    <p className="mt-3 font-medium">
                      {row.provider.verification === "verified"
                        ? "Fiche vérifiée"
                        : row.provider.verification === "partial"
                          ? "Informations partielles"
                          : "Informations insuffisantes dans le catalogue StackLégal"}
                    </p>
                    {row.provider.missing.length > 0 ? (
                      <p className="mt-1">
                        Champs manquants :{" "}
                        {row.provider.missing
                          .map((item) => missingLabels[item] ?? item)
                          .join(", ")}
                      </p>
                    ) : null}
                    {row.provider.officialUrl ? (
                      <a
                        href={row.provider.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-block text-[#8793ff] underline"
                      >
                        Document officiel ({value(row.provider.officialUrlKind)}
                        )
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-4 text-amber-200">
                    Enrichissement StackLégal temporairement indisponible.
                  </p>
                )
              ) : null}
            </article>
          ))}
        </div>
      )}
      <p className="mt-5 text-xs text-[#7f8a9f]">
        Données réglementaires :{" "}
        <a
          href="https://stacklegal.eu"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          StackLégal
        </a>
      </p>
    </section>
  );
}
