"use client";

import { useActionState } from "react";
import {
  grantDeepCrawlConsentAction,
  revokeDeepCrawlConsentAction,
  type DeepCrawlConsentActionState,
} from "./deep-crawl-consent-actions";

export type DeepCrawlConsentView = {
  maxPages: number;
  allowedPathPrefixes: string[];
  expiresAt: string;
  revokedAt: string | null;
  revision: number;
  isActive: boolean;
};

const initial: DeepCrawlConsentActionState = { error: null, message: null };

export function DeepCrawlConsentPanel(props: {
  organizationId: string;
  siteId: string;
  canManage: boolean;
  consent: DeepCrawlConsentView | null;
}) {
  const grant = grantDeepCrawlConsentAction.bind(
    null,
    props.organizationId,
    props.siteId,
  );
  const revoke = revokeDeepCrawlConsentAction.bind(
    null,
    props.organizationId,
    props.siteId,
  );
  const [grantState, submitGrant, pendingGrant] = useActionState(
    grant,
    initial,
  );
  const [revokeState, submitRevoke, pendingRevoke] = useActionState(
    revoke,
    initial,
  );
  const current = props.consent?.isActive === true;
  return (
    <section
      aria-labelledby="crawl-consent-title"
      className="mt-10 border-t border-[#303a50] pt-9"
    >
      <p className="am-kicker">
        Fonction expérimentale · préparation uniquement
      </p>
      <h2 id="crawl-consent-title" className="mt-2 text-2xl font-semibold">
        Consentement Deep multi-pages
      </h2>
      <p className="mt-3 max-w-3xl text-base leading-7 text-[#aeb9cc]">
        Cette autorisation prépare la sélection de pages internes. Elle
        <strong className="ml-1 text-white">
          n’active aucun nouveau parcours
        </strong>{" "}
        : le scanner continue d’observer uniquement la page d’entrée jusqu’à
        validation et déploiement distincts du moteur multi-pages.
      </p>
      <div className="am-panel mt-6 p-6">
        <p className="text-sm font-semibold text-white">
          {current ? "Consentement enregistré" : "Aucun consentement valide"}
        </p>
        <p className="mt-2 text-sm leading-6 text-[#aeb9cc]">
          {props.consent
            ? "Version " +
              props.consent.revision +
              " · plafond " +
              props.consent.maxPages +
              " pages (entrée comprise)" +
              " · expiration : " +
              new Intl.DateTimeFormat("fr-FR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "Europe/Paris",
              }).format(new Date(props.consent.expiresAt))
            : "Aucun accord n’a été enregistré pour ce site."}
        </p>
        {props.consent ? (
          <div className="mt-3">
            <p className="text-sm font-medium text-[#ced6e5]">
              Périmètres enregistrés :
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#aeb9cc]">
              {props.consent.allowedPathPrefixes.map((path) => (
                <li key={path}>
                  <code className="break-all">{path}</code>
                </li>
              ))}
            </ul>
            {props.consent.revokedAt ? (
              <p className="mt-3 text-sm text-amber-100">
                Accord révoqué. Une nouvelle autorisation explicite sera
                nécessaire.
              </p>
            ) : null}
          </div>
        ) : null}
        {!props.canManage ? (
          <p className="mt-5 text-sm text-[#aeb9cc]">
            Seuls les propriétaires et administrateurs peuvent modifier ce
            consentement.
          </p>
        ) : (
          <>
            <form action={submitGrant} className="mt-6 space-y-5">
              <label
                className="block text-sm font-medium text-white/85"
                htmlFor="deep-crawl-page-limit"
              >
                Plafond des pages à autoriser
              </label>
              <select
                id="deep-crawl-page-limit"
                name="maxPages"
                className="am-field w-full max-w-52"
                defaultValue={props.consent?.maxPages ?? 3}
                disabled={pendingGrant}
                required
              >
                {[2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} pages maximum
                  </option>
                ))}
              </select>
              <label
                className="block text-sm font-medium text-white/85"
                htmlFor="deep-crawl-paths"
              >
                Chemins HTML autorisés (un par ligne, au maximum 10)
              </label>
              <textarea
                id="deep-crawl-paths"
                name="pathPrefixes"
                required
                rows={4}
                maxLength={1500}
                className="am-field w-full"
                placeholder={"/blog/\n/actualites/\n/a-propos"}
                defaultValue={
                  props.consent?.allowedPathPrefixes.join("\n") ?? ""
                }
                disabled={pendingGrant}
                aria-describedby="deep-crawl-path-explanation"
              />
              <p
                id="deep-crawl-path-explanation"
                className="text-sm leading-6 text-[#aeb9cc]"
              >
                La racine /, les chemins sensibles, les paramètres et les
                domaines externes sont refusés. Les chemins donnés doivent être
                sous votre contrôle. Durée maximale : 24 heures ; les preuves
                DNS doivent être récemment revalidées.
              </p>
              <label className="flex items-start gap-3 text-sm leading-6 text-white/85">
                <input
                  type="checkbox"
                  name="confirmation"
                  value="yes"
                  required
                  disabled={pendingGrant}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#6d7cff]"
                />
                Je confirme être autorisé à faire analyser ces chemins HTML
                internes et comprendre que ce consentement ne lance pas de scan.
              </label>
              <button
                type="submit"
                disabled={pendingGrant || pendingRevoke}
                className="am-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingGrant
                  ? "Enregistrement…"
                  : "Enregistrer le consentement"}
              </button>
              {grantState.error ? (
                <p role="alert" className="text-sm text-amber-100">
                  {grantState.error}
                </p>
              ) : null}
              {grantState.message ? (
                <p role="status" className="text-sm text-[#a3e4c9]">
                  {grantState.message}
                </p>
              ) : null}
            </form>
            {current ? (
              <form
                action={submitRevoke}
                className="mt-7 border-t border-[#303a50] pt-5"
              >
                <label className="flex items-center gap-3 text-sm text-[#dde6f0]">
                  <input
                    type="checkbox"
                    name="confirmation"
                    value="revoke"
                    required
                    className="h-4 w-4 accent-[#6d7cff]"
                    disabled={pendingRevoke}
                  />
                  Je confirme la révocation immédiate de cet accord.
                </label>
                <button
                  type="submit"
                  disabled={pendingGrant || pendingRevoke}
                  className="am-button-secondary mt-4 disabled:opacity-50"
                >
                  {pendingRevoke ? "Révocation…" : "Révoquer le consentement"}
                </button>
                {revokeState.error ? (
                  <p role="alert" className="mt-3 text-sm text-amber-100">
                    {revokeState.error}
                  </p>
                ) : null}
                {revokeState.message ? (
                  <p role="status" className="mt-3 text-sm text-[#a3e4c9]">
                    {revokeState.message}
                  </p>
                ) : null}
              </form>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
