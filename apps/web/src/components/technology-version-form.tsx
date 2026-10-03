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

export function TechnologyVersionForm({
  organizationId,
  siteId,
  observationId,
  declaredVersion,
  matchCount,
}: {
  organizationId: string;
  siteId: string;
  observationId: string;
  declaredVersion: string | null;
  matchCount: number;
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
  return (
    <form action={action} className="mt-4 border-t border-[#303a50] pt-4">
      <label htmlFor={inputId} className="text-sm font-semibold text-[#cbd4e5]">
        Version installée à déclarer
      </label>
      <p className="mt-1 text-xs leading-5 text-[#8d98ad]">
        Retrouvez la version dans votre déploiement ou auprès de votre
        hébergeur. Une seule saisie permet de comparer les {matchCount} CVE de
        cette technologie.
      </p>
      <input
        id={inputId}
        name="version"
        type="text"
        required
        maxLength={32}
        pattern="[0-9]+\.[0-9]+\.[0-9]+"
        defaultValue={declaredVersion ?? ""}
        placeholder="Exemple de format : 2.4.65"
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
      <p className="mt-3 text-xs leading-5 text-[#7f8a9f]">
        Cette version est une déclaration administrateur, liée à ce scan. Elle
        devra être reconfirmée après une nouvelle observation.
      </p>
    </form>
  );
}
