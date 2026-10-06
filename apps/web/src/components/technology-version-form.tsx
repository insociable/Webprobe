"use client";

import { useActionState } from "react";
import {
  setTechnologyVersionAction,
  type TechnologyVersionActionState,
} from "../app/organizations/[organizationId]/sites/[siteId]/technology-version-actions";

const initialState: TechnologyVersionActionState = {
  error: null,
  saved: false,
};

const versionHelp: Record<string, { example: string; guidance: string }> = {
  http_server: {
    example: "2.4.65",
    guidance:
      "Demandez à votre hébergeur la version d’Apache HTTP Server qui sert ce site. Un administrateur peut la vérifier sur le serveur avec apache2 -v ou httpd -v. La version du système d’exploitation est une autre information.",
  },
  nginx: {
    example: "1.28.0",
    guidance:
      "Demandez à votre hébergeur la version de nginx qui sert ce site, ou vérifiez nginx -v sur ce serveur. Si un proxy est placé devant l’application, identifiez bien le composant observé.",
  },
  php: {
    example: "8.4.13",
    guidance:
      "Consultez la version PHP du site dans le panneau de votre hébergeur. Un administrateur peut vérifier PHP-FPM ; php -v indique la version en ligne de commande, qui peut être différente de celle utilisée par le site.",
  },
  "next.js": {
    example: "16.3.8",
    guidance:
      "Cherchez la version exacte de next dans le lockfile du déploiement en production (pnpm-lock.yaml, package-lock.json ou yarn.lock), ou demandez-la au développeur. Une plage comme ^16 dans package.json ne donne pas la version réellement installée.",
  },
  express: {
    example: "5.1.0",
    guidance:
      "Cherchez la version exacte d’express dans le lockfile du déploiement en production, ou demandez-la au développeur. Renseignez Express, pas la version de Node.js.",
  },
  wordpress: {
    example: "6.8.3",
    guidance:
      "Dans l’administration WordPress, ouvrez Tableau de bord → Mises à jour, ou demandez la version à la personne qui gère le site. Renseignez WordPress, pas la version du thème ou d’une extension.",
  },
  drupal: {
    example: "11.2.0",
    guidance:
      "Consultez le rapport d’état dans l’administration Drupal, ou vérifiez la version installée via Composer avec votre développeur.",
  },
  joomla: {
    example: "5.3.0",
    guidance:
      "Consultez Système → Informations système dans l’administration Joomla, ou demandez la version exacte du CMS à la personne qui gère le site.",
  },
};

export function TechnologyVersionForm({
  organizationId,
  siteId,
  observationId,
  declaredVersion,
  matchCount,
  technologyLabel,
  technologyProduct,
  comparison,
}: {
  organizationId: string;
  siteId: string;
  observationId: string;
  declaredVersion: string | null;
  matchCount: number;
  technologyLabel: string;
  technologyProduct: string;
  comparison: { affected: number; excluded: number; unknown: number };
}) {
  const [state, action, pending] = useActionState(
    setTechnologyVersionAction.bind(
      null,
      organizationId,
      siteId,
      observationId,
    ),
    initialState,
  );
  const inputId = `technology-version-${observationId}`;
  const helpId = `${inputId}-help`;
  const limitId = `${inputId}-limits`;
  const help = versionHelp[technologyProduct] ?? {
    example: "1.2.3",
    guidance:
      "Demandez au développeur ou à l’hébergeur la version exacte de ce composant dans le déploiement en production. Si vous ne pouvez pas la confirmer, laissez les CVE à vérifier.",
  };
  return (
    <form action={action} className="mt-4 border-t border-[#303a50] pt-4">
      <label htmlFor={inputId} className="text-sm font-semibold text-[#cbd4e5]">
        Quelle version de {technologyLabel} est installée ?
      </label>
      <p id={helpId} className="mt-1 text-xs leading-5 text-[#aeb9cc]">
        Renseignez la version exacte du composant qui sert ce site, au format
        X.Y.Z. Elle sera comparée aux {matchCount} CVE de cette technologie.
      </p>
      <details className="mt-2 text-xs leading-5 text-[#aeb9cc]">
        <summary className="cursor-pointer font-semibold text-[#b6bfff]">
          Où trouver la version de {technologyLabel} ?
        </summary>
        <p className="mt-2">{help.guidance}</p>
        <p className="mt-2">
          La version de votre navigateur n’est pas celle du site. Les numéros
          ci-dessous sont des exemples de format, pas des recommandations de
          mise à jour.
        </p>
      </details>
      <input
        id={inputId}
        aria-describedby={`${helpId} ${limitId}`}
        name="version"
        type="text"
        required
        maxLength={32}
        pattern="[0-9]+\.[0-9]+\.[0-9]+"
        defaultValue={declaredVersion ?? ""}
        placeholder={`Exemple de format : ${help.example}`}
        autoComplete="off"
        disabled={pending}
        className="mt-3 w-full rounded-md border border-[#39445d] bg-[#0d121d] px-3 py-2 font-mono text-sm text-[#e2e7f1]"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="am-button-primary text-sm disabled:opacity-50"
        >
          {pending ? "Vérification…" : "Comparer le lot de CVE"}
        </button>
        {declaredVersion ? (
          <button
            type="submit"
            name="remove"
            value="1"
            formNoValidate
            disabled={pending}
            className="text-xs text-[#aeb9cc] underline underline-offset-4 disabled:opacity-50"
          >
            Retirer la version déclarée
          </button>
        ) : null}
      </div>
      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-amber-100">
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p role="status" className="mt-3 text-sm text-emerald-100">
          Comparaison du lot actualisée.
        </p>
      ) : null}
      {declaredVersion ? (
        <p className="mt-3 text-sm leading-6 text-[#cbd4e5]">
          Pour la version déclarée {declaredVersion} : {comparison.affected}{" "}
          correspondance(s) de version confirmée(s), {comparison.excluded} CVE
          écartée(s) par version, {comparison.unknown} encore à vérifier.
        </p>
      ) : null}
      <p id={limitId} className="mt-3 text-xs leading-5 text-[#aeb9cc]">
        Une version déclarée par un administrateur n’est pas une détection
        réseau. Les règles incomplètes ou le contexte inconnu restent à
        vérifier. Reconfirmez la version après un nouveau scan. Les rapports
        historiques restent inchangés.
      </p>
    </form>
  );
}
