"use client";

import { useActionState } from "react";
import {
  updateDisplayNameAction,
  type DisplayNameActionState,
} from "./actions";

const initialState: DisplayNameActionState = { error: null, message: null };

export function ProfileNameForm({ currentName }: { currentName: string }) {
  const [state, formAction, pending] = useActionState(
    updateDisplayNameAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          name="displayName"
          required
          minLength={2}
          maxLength={80}
          defaultValue={currentName}
          placeholder="Votre nom affiché"
          className="am-field min-w-0 flex-1"
        />
        <button
          disabled={pending}
          className="am-button-secondary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
      {state.error ? (
        <p aria-live="polite" className="text-xs text-amber-100">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p aria-live="polite" className="text-xs text-emerald-200">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
