"use client";

import { useActionState } from "react";
import {
  initialManualScanActionState,
  startManualScanAction,
} from "./manual-scan-actions";

type ManualScanButtonProps = {
  organizationId: string;
  siteId: string;
};

export function ManualScanButton({
  organizationId,
  siteId,
}: ManualScanButtonProps) {
  const action = startManualScanAction.bind(null, organizationId, siteId);
  const [state, formAction, pending] = useActionState(
    action,
    initialManualScanActionState,
  );

  return (
    <div className="mt-5">
      <form action={formAction}>
        <button
          disabled={pending}
          className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Mise en file…" : "Lancer un scan"}
        </button>
      </form>

      {state.message ? (
        <p
          aria-live="polite"
          className="mt-3 text-xs leading-5 text-emerald-200"
        >
          {state.message}
        </p>
      ) : null}

      {state.error ? (
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-amber-100">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
