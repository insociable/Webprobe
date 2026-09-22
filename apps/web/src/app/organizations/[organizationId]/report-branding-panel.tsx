"use client";

import { useActionState } from "react";
import {
  initialReportBrandingActionState,
  updateReportBrandingAction,
} from "./report-branding-actions";

type ReportBrandingPanelProps = {
  organizationId: string;
  brandName: string | null;
  accentColor: string;
};

export function ReportBrandingPanel({
  organizationId,
  brandName,
  accentColor,
}: ReportBrandingPanelProps) {
  const action = updateReportBrandingAction.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(
    action,
    initialReportBrandingActionState,
  );

  return (
    <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.035] p-6">
      <p className="text-sm text-white/45">Rapports clients</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">
        Branding agence
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
        Le nom et la couleur ci-dessous apparaissent sur les rapports publics et
        dans les e-mails envoyés aux clients.
      </p>

      <form
        action={formAction}
        className="mt-6 grid gap-5 md:grid-cols-[1fr_auto_auto] md:items-end"
      >
        <label className="text-sm text-white/55">
          Nom affiché
          <input
            name="brandName"
            defaultValue={brandName ?? ""}
            maxLength={80}
            placeholder="Nom de l’agence"
            className="mt-2 block w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-white outline-none focus:border-emerald-300/40"
          />
        </label>

        <label className="text-sm text-white/55">
          Couleur
          <input
            name="accentColor"
            type="color"
            defaultValue={accentColor}
            className="mt-2 block h-11 w-20 rounded-lg border border-white/10 bg-black/25 p-1"
          />
        </label>

        <button
          disabled={pending}
          className="rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:opacity-50"
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
