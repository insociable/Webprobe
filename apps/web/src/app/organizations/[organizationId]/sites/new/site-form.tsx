"use client";

import { useActionState } from "react";
import { createSiteAction, type CreateSiteActionState } from "./actions";

const initialState: CreateSiteActionState = { error: null };

export function SiteForm({ organizationId }: { organizationId: string }) {
  const action = createSiteAction.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="mt-7 space-y-5">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/70">
          URL du site
        </span>
        <input
          autoFocus
          required
          inputMode="url"
          name="canonicalUrl"
          placeholder="https://entreprise.fr"
          className="am-field text-base"
        />
        <span className="mt-2 block text-xs leading-5 text-white/35">
          Analyse non intrusive des éléments publiquement accessibles.
        </span>
      </label>

      <details className="rounded-lg border border-[#242d40] bg-[#0b1019]">
        <summary className="cursor-pointer list-none px-4 py-3 text-xs font-medium text-[#7f8a9f] [&::-webkit-details-marker]:hidden">
          Nom personnalisé — facultatif ▾
        </summary>
        <div className="border-t border-[#242d40] p-4">
          <label className="block">
            <span className="mb-2 block text-xs text-white/45">
              Nom affiché dans WebProbe
            </span>
            <input
              minLength={2}
              maxLength={160}
              name="name"
              placeholder="Par défaut : nom de domaine"
              className="am-field"
            />
          </label>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-4">
        <button
          disabled={pending}
          className="am-button-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Lancement…" : "Lancer l’audit"}
        </button>
        <span className="text-xs text-[#59647a]">
          Sécurité · Performance · SEO · Réseau · Accessibilité
        </span>
      </div>

      {state.error ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-red-300/20 bg-red-300/[0.06] px-4 py-3 text-sm text-red-100"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
