"use client";

import { useActionState } from "react";
import {
  startPublicAuditAction,
  type PublicAuditActionState,
} from "./public-audit-actions";

const initialState: PublicAuditActionState = {
  error: null,
  message: null,
};

export function PublicAuditButton({
  organizationId,
  siteId,
  appearance = "primary",
  label = "Lancer l’audit public",
}: {
  organizationId: string;
  siteId: string;
  appearance?: "primary" | "secondary" | "link";
  label?: string;
}) {
  const action = startPublicAuditAction.bind(null, organizationId, siteId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div>
      <form action={formAction}>
        <button
          disabled={pending}
          className={
            (appearance === "primary"
              ? "am-button-primary"
              : appearance === "secondary"
                ? "am-button-secondary"
                : "text-sm font-semibold text-[#7d8aff] transition hover:text-[#aab2ff]") +
            " disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {pending ? "Mise en file…" : label}
        </button>
      </form>
      {state.error ? (
        <p aria-live="polite" className="mt-2 max-w-sm text-xs text-amber-100">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
