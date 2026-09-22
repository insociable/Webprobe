"use client";

import { useActionState } from "react";
import { startManualScanAction } from "./manual-scan-actions";
import type { ManualScanActionState } from "./manual-scan-actions";

const initialManualScanActionState: ManualScanActionState = {
  error: null,
  message: null,
};

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
          className="am-button-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Mise en file…" : "Lancer un scan"}
        </button>
      </form>

      {state.message ? (
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-[#8f9aff]">
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
