"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import {
  updateDisplayNameAction,
  type DisplayNameActionState,
} from "@/lib/user-profile-actions";

const initialState: DisplayNameActionState = {
  error: null,
  message: null,
};

export function WorkspaceAccountMenuClient({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateDisplayNameAction,
    initialState,
  );

  useEffect(() => {
    if (state.message) {
      router.refresh();
    }
  }, [router, state.message]);

  const initial = (displayName || email).trim().charAt(0).toUpperCase() || "?";

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg border border-[#263149] bg-[#0d121d] px-3 py-3 transition hover:border-[#3b4968] hover:bg-[#111827] [&::-webkit-details-marker]:hidden">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-[#33405a] bg-[#151c2b] text-xs font-semibold text-[#dfe5f2]">
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[#e3e8f2]">
            {displayName || "Compte"}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-[#657188]">
            {email}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="text-xs text-[#6f7b91] transition group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="mt-2 rounded-lg border border-[#2a354d] bg-[#0b1019] p-3 shadow-2xl">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#59647a]">
          Nom affiché
        </p>
        <form action={formAction} className="mt-2 space-y-2">
          <input
            name="displayName"
            required
            minLength={2}
            maxLength={80}
            defaultValue={displayName}
            placeholder="Votre nom affiché"
            className="am-field px-3 py-2 text-sm"
          />
          <button
            disabled={pending}
            className="am-button-secondary min-h-9 w-full px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Enregistrement…" : "Modifier le nom"}
          </button>
        </form>

        {state.error ? (
          <p aria-live="polite" className="mt-2 text-[11px] text-amber-200">
            {state.error}
          </p>
        ) : null}
        {state.message ? (
          <p aria-live="polite" className="mt-2 text-[11px] text-emerald-200">
            {state.message}
          </p>
        ) : null}

        <div className="my-3 border-t border-[#20283a]" />
        <SignOutButton compact />
      </div>
    </details>
  );
}
