"use client";

import { useActionState } from "react";
import {
  createInitialOrganizationAction,
  type OnboardingActionState,
} from "./actions";

const initialState: OnboardingActionState = { error: null };

export function OrganizationForm() {
  const [state, formAction, pending] = useActionState(
    createInitialOrganizationAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/70">
          Nom de l’agence
        </span>
        <input
          autoFocus
          required
          minLength={2}
          maxLength={120}
          name="name"
          placeholder="Agence Nord"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-emerald-300/60"
        />
      </label>

      <button
        disabled={pending}
        className="rounded-xl bg-emerald-300 px-5 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Création…" : "Créer mon espace agence"}
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
