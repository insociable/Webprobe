"use client";

import { useActionState } from "react";
import { updateScanAlertPreferencesAction } from "./alert-preference-actions";
import type { ScanAlertPreferenceActionState } from "./alert-preference-actions";

const initialScanAlertPreferenceActionState: ScanAlertPreferenceActionState = {
  error: null,
  message: null,
};

type AlertPreferencePanelProps = {
  organizationId: string;
  enabled: boolean;
  minimumSeverity: "medium" | "high" | "critical";
};

const severityLabels = {
  medium: "Medium et plus",
  high: "High et critical",
  critical: "Critical uniquement",
} as const;

export function AlertPreferencePanel({
  organizationId,
  enabled,
  minimumSeverity,
}: AlertPreferencePanelProps) {
  const action = updateScanAlertPreferencesAction.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(
    action,
    initialScanAlertPreferenceActionState,
  );

  return (
    <section className="am-panel mb-6 p-6">
      <p className="text-sm text-white/45">Notifications</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">
        Alertes de dégradation
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
        Recevez un e-mail uniquement lorsqu’un nouveau finding atteint votre
        seuil ou lorsqu’un finding existant s’aggrave. Le premier scan sert de
        référence et ne déclenche pas d’alerte.
      </p>

      <form
        action={formAction}
        className="mt-6 flex flex-col gap-5 md:flex-row md:items-end"
      >
        <label className="flex items-center gap-3 text-sm text-white/70">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={enabled}
            className="h-4 w-4 accent-[#6d7cff]"
          />
          Activer mes alertes e-mail
        </label>

        <label className="text-sm text-white/55">
          Seuil minimum
          <select
            name="minimumSeverity"
            defaultValue={minimumSeverity}
            className="am-field mt-2 min-w-52"
          >
            {Object.entries(severityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button
          disabled={pending}
          className="am-button-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>

      {state.message ? (
        <p aria-live="polite" className="mt-4 text-sm text-[#51d3a5]">
          {state.message}
        </p>
      ) : null}

      {state.error ? (
        <p aria-live="polite" className="mt-4 text-sm text-amber-100">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
