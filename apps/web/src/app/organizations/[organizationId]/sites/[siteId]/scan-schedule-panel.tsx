"use client";

import { useActionState } from "react";
import { updateScanScheduleAction } from "./schedule-actions";
import type { ScanScheduleActionState } from "./schedule-actions";

const initialScanScheduleActionState: ScanScheduleActionState = {
  error: null,
  message: null,
};

type ScheduleView = {
  enabled: boolean;
  dayOfWeek: number;
  minuteOfDay: number;
  timeZone: string;
  nextRunAt: string | null;
};

type ScanSchedulePanelProps = {
  organizationId: string;
  siteId: string;
  canManage: boolean;
  siteActive: boolean;
  schedule: ScheduleView | null;
};

const dayLabels = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
] as const;
function timeValue(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatNextRun(value: string | null, timeZone: string): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function ScanSchedulePanel({
  organizationId,
  siteId,
  canManage,
  siteActive,
  schedule,
}: ScanSchedulePanelProps) {
  const action = updateScanScheduleAction.bind(null, organizationId, siteId);
  const [state, formAction, pending] = useActionState(
    action,
    initialScanScheduleActionState,
  );
  const values = schedule ?? {
    enabled: false,
    dayOfWeek: 1,
    minuteOfDay: 9 * 60,
    timeZone: "Europe/Paris",
    nextRunAt: null,
  };

  if (!canManage) {
    return (
      <div className="am-panel p-6">
        <p className="text-sm text-white/45">Planification</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">
          Scan hebdomadaire
        </h2>
        <p className="mt-4 text-sm text-white/55">
          {schedule?.enabled
            ? `${dayLabels[schedule.dayOfWeek - 1]} à ${timeValue(schedule.minuteOfDay)} — ${schedule.timeZone}`
            : "Aucune planification active."}
        </p>
        {schedule?.enabled ? (
          <p className="mt-2 text-xs text-white/35">
            Prochaine exécution :{" "}
            {formatNextRun(schedule.nextRunAt, schedule.timeZone)}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="am-panel p-6">
      <p className="text-sm text-white/45">Planification</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">
        Scan hebdomadaire
      </h2>
      <p className="mt-3 text-sm leading-6 text-white/45">
        Choisissez un créneau récurrent. La planification est conservée même si
        le moteur de scan redémarre temporairement.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span
          className={
            "size-2 rounded-full " +
            (!siteActive
              ? "bg-[#6d7cff]"
              : values.enabled
                ? "bg-[#51d3a5]"
                : "bg-[#ffb45f]")
          }
        />
        <span className="text-sm font-semibold text-white/70">
          {!siteActive
            ? "Vérification requise"
            : values.enabled
              ? "Monitoring actif"
              : "Monitoring inactif"}
        </span>
      </div>

      <form action={formAction} className="mt-6 space-y-5">
        <label className="flex items-center gap-3 text-sm text-white/70">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={values.enabled}
            disabled={!siteActive}
            className="h-4 w-4 accent-[#6d7cff] disabled:cursor-not-allowed disabled:opacity-50"
          />
          Activer le scan automatique
        </label>

        {!siteActive ? (
          <p className="text-xs leading-5 text-amber-100/80">
            Le site doit être vérifié et actif pour activer la planification.
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-white/55">
            Jour
            <select
              name="dayOfWeek"
              defaultValue={values.dayOfWeek}
              disabled={!siteActive}
              className="am-field mt-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {dayLabels.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-white/55">
            Heure locale
            <input
              name="time"
              type="time"
              required
              defaultValue={timeValue(values.minuteOfDay)}
              disabled={!siteActive}
              className="am-field mt-2 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </div>

        <label className="block text-sm text-white/55">
          Fuseau horaire IANA
          <input
            name="timeZone"
            required
            maxLength={100}
            defaultValue={values.timeZone}
            disabled={!siteActive}
            className="am-field mt-2 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        {values.enabled ? (
          <p className="text-xs text-white/35">
            Prochaine exécution :{" "}
            {formatNextRun(values.nextRunAt, values.timeZone)}
          </p>
        ) : null}

        <button
          disabled={pending || !siteActive}
          className="am-button-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending
            ? "Enregistrement…"
            : siteActive
              ? "Enregistrer la planification"
              : "Vérification requise"}
        </button>
      </form>

      {state.message ? (
        <p
          aria-live="polite"
          className="mt-4 border-l-2 border-[#51d3a5] bg-[#0d1715] px-4 py-3 text-sm text-[#9fd2bd]"
        >
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p
          aria-live="polite"
          className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100"
        >
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
