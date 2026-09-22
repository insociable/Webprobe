"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { startManualScanAction } from "./manual-scan-actions";
import type { ManualScanActionState } from "./manual-scan-actions";

const initialManualScanActionState: ManualScanActionState = {
  error: null,
  message: null,
  scanId: null,
};

type ManualScanButtonProps = {
  organizationId: string;
  siteId: string;
};

export function ManualScanButton({
  organizationId,
  siteId,
}: ManualScanButtonProps) {
  const router = useRouter();
  const action = startManualScanAction.bind(null, organizationId, siteId);
  const [state, formAction, pending] = useActionState(
    action,
    initialManualScanActionState,
  );

  useEffect(() => {
    if (!state.scanId) {
      return;
    }

    router.push(
      `/organizations/${organizationId}/sites/${siteId}/scans/${state.scanId}`,
    );
  }, [organizationId, router, siteId, state.scanId]);

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
