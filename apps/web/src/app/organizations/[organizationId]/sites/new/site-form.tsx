"use client";

import { useActionState } from "react";
import { createSiteAction, type CreateSiteActionState } from "./actions";

const initialState: CreateSiteActionState = { error: null };

export function SiteForm({ organizationId }: { organizationId: string }) {
  const action = createSiteAction.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/70">
          Nom du site
        </span>
        <input
          autoFocus
          required
          minLength={2}
          maxLength={160}
          name="name"
          placeholder="Site vitrine"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-emerald-300/60"
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/70">
          URL principale
        </span>
        <input
          required
          inputMode="url"
          name="canonicalUrl"
          placeholder="https://www.exemple.fr"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-emerald-300/60"
        />
        <span className="mt-2 block text-xs leading-5 text-white/35">
          HTTP(S) uniquement, sans paramètres, fragment, identifiants ou port
          non standard.
        </span>
      </label>

      <button
        disabled={pending}
        className="rounded-xl bg-emerald-300 px-5 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Ajout…" : "Ajouter le site"}
      </button>
      {state.error ? (
        <p
          aria-live="polite"
          className="rounded-xl border border-red-300/20 bg-red-300/[0.06] px-4 py-3 text-sm text-red-100"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
