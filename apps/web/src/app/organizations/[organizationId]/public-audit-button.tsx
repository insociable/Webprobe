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
}: {
  organizationId: string;
  siteId: string;
}) {
  const action = startPublicAuditAction.bind(null, organizationId, siteId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div>
      <form action={formAction}>
        <button
          disabled={pending}
          className="am-button-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Mise en file…" : "Lancer l’audit public"}
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
