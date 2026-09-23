"use client";

import { useActionState } from "react";
import {
  updateOrganizationNameAction,
  type OrganizationNameActionState,
} from "./actions";

const initialState: OrganizationNameActionState = {
  error: null,
  message: null,
};

export function OrganizationNameForm({
  organizationId,
  currentName,
}: {
  organizationId: string;
  currentName: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateOrganizationNameAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-4 max-w-xl space-y-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <label className="block">
        <span className="mb-2 block text-xs text-white/40">
          Nom de l’espace
        </span>
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={currentName}
          className="am-field"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          disabled={pending}
          className="am-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : "Renommer l’espace"}
        </button>
        {state.error ? (
          <p aria-live="polite" className="text-xs text-amber-200">
            {state.error}
          </p>
        ) : null}
        {state.message ? (
          <p aria-live="polite" className="text-xs text-emerald-200">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
