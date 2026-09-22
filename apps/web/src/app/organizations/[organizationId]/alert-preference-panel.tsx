"use client";

import { useActionState } from "react";
import {
  initialScanAlertPreferenceActionState,
  updateScanAlertPreferencesAction,
} from "./alert-preference-actions";

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
    <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.035] p-6">
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
            className="h-4 w-4 accent-emerald-300"
          />
          Activer mes alertes e-mail
        </label>

        <label className="text-sm text-white/55">
          Seuil minimum
          <select
            name="minimumSeverity"
            defaultValue={minimumSeverity}
            className="mt-2 block min-w-52 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-white outline-none focus:border-emerald-300/40"
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
          className="rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>

      {state.message ? (
        <p aria-live="polite" className="mt-4 text-sm text-emerald-200">
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
