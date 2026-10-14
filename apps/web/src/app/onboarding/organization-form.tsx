"use client";

import { useActionState, useState } from "react";
import {
  createInitialOrganizationAction,
  type OnboardingActionState,
} from "./actions";

const initialState: OnboardingActionState = { error: null };

export function OrganizationForm({
  initialDisplayName = "",
}: {
  initialDisplayName?: string;
}) {
  const [state, formAction, pending] = useActionState(
    createInitialOrganizationAction,
    initialState,
  );
  const [displayName, setDisplayName] = useState(initialDisplayName);

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/70">
          Nom affiché
        </span>
        <input
          autoFocus
          required
          minLength={2}
          maxLength={80}
          name="displayName"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          aria-invalid={!!state.error && state.error.startsWith("Le nom")}
          aria-describedby={
            state.error
              ? "onboarding-name-help onboarding-form-error"
              : "onboarding-name-help"
          }
          placeholder="Alex Martin"
          className="am-field"
        />
        <span
          id="onboarding-name-help"
          className="mt-2 block text-xs leading-5 text-white/35"
        >
          Utilisé dans l’interface. Vous pourrez le modifier ensuite.
        </span>
      </label>

      <button
        disabled={pending}
        className="am-button-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Enregistrement…" : "Continuer"}
      </button>

      {state.error ? (
        <p
          id="onboarding-form-error"
          role="alert"
          className="rounded-xl border border-red-300/20 bg-red-300/[0.06] px-4 py-3 text-sm text-red-100"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
