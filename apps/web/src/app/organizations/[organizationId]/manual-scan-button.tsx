"use client";

import { useActionState } from "react";
import {
  startDeepScanAction,
  startManualScanAction,
  type ManualScanActionState,
} from "./manual-scan-actions";

const initialState: ManualScanActionState = {
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
  const standardAction = startManualScanAction.bind(
    null,
    organizationId,
    siteId,
  );
  const deepAction = startDeepScanAction.bind(null, organizationId, siteId);
  const [standardState, standardFormAction, standardPending] = useActionState(
    standardAction,
    initialState,
  );
  const [deepState, deepFormAction, deepPending] = useActionState(
    deepAction,
    initialState,
  );
  const error = standardState.error ?? deepState.error;

  return (
    <div className="rounded-lg border border-[#242d40] bg-[#0d111a] p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#647188]">
        Actions immédiates
      </p>
      <p className="mt-1 text-xs leading-5 text-[#7f8a9f]">
        Standard pour le contrôle courant, approfondi pour une analyse Deep.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <form action={standardFormAction}>
          <button
            disabled={standardPending || deepPending}
            className="am-button-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {standardPending ? "Mise en file…" : "Lancer un scan"}
          </button>
        </form>
        <form action={deepFormAction}>
          <button
            disabled={standardPending || deepPending}
            className="am-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deepPending ? "Mise en file…" : "Lancer un scan approfondi"}
          </button>
        </form>
      </div>

      {error ? (
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-amber-100">
          {error}
        </p>
      ) : null}
    </div>
  );
}
