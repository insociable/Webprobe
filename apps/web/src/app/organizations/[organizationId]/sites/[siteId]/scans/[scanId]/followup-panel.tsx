"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef, useState } from "react";
import { updateFindingFollowupAction } from "./followup-actions";

const labels: Record<string, string> = {
  todo: "À traiter",
  in_progress: "En cours",
  to_verify: "À vérifier",
  fixed: "Corrigé",
  accepted: "Risque accepté",
};

type Followup = {
  status: string;
  assigneeUserId: string | null;
  dueAt: Date | null;
  updatedByUserId: string | null;
  updatedAt: Date;
  lastSeenScanId: string | null;
  suggestedScanId: string | null;
  reopenedAt: Date | null;
  acceptanceReason: string | null;
} | null;
type Member = { id: string; name: string };
type Event = {
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: string | null;
  scanId: string | null;
  note: string | null;
  createdAt: Date;
};

export function FollowupPanel({
  organizationId,
  siteId,
  scanId,
  fingerprint,
  followup,
  members,
  events,
  canManage,
}: {
  organizationId: string;
  siteId: string;
  scanId: string;
  fingerprint: string;
  followup: Followup;
  members: Member[];
  events: Event[];
  canManage: boolean;
}) {
  const [note, setNote] = useState("");
  const noteRevision = useRef(0);
  const submittedRevision = useRef<number | null>(null);
  const submitting = useRef(false);
  const [state, action, pending] = useActionState(
    async (
      previousState: { error: string | null; saved: boolean },
      formData: FormData,
    ) => {
      let result: { error: string | null; saved: boolean };
      try {
        result = await updateFindingFollowupAction(
          organizationId,
          siteId,
          scanId,
          fingerprint,
          previousState,
          formData,
        );
      } catch {
        result = {
          error:
            "Mise à jour impossible. Vérifiez votre connexion et réessayez.",
          saved: false,
        };
      }
      if (result.saved && noteRevision.current === submittedRevision.current) {
        noteRevision.current += 1;
        setNote("");
      }
      submittedRevision.current = null;
      submitting.current = false;
      return result;
    },
    { error: null, saved: false },
  );
  const [status, setStatus] = useState(followup?.status ?? "todo");
  const [assignee, setAssignee] = useState(followup?.assigneeUserId ?? "");
  const [due, setDue] = useState(
    followup?.dueAt?.toISOString().slice(0, 10) ?? "",
  );
  const errorId = `followup-error-${fingerprint}`;
  const memberName = (id: string | null) =>
    members.find((member) => member.id === id)?.name ??
    "Système / membre retiré";
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Paris",
    }).format(date);
  return (
    <details className="mt-5 rounded-lg border border-[#303a50] bg-[#101724] p-4">
      <summary className="cursor-pointer font-semibold text-[#aab2ff]">
        Suivi de remédiation · {labels[followup?.status ?? "todo"]}
      </summary>
      <div className="mt-4 space-y-3 text-sm text-white/60">
        {followup ? (
          <>
            <p>
              Responsable :{" "}
              {followup.assigneeUserId
                ? memberName(followup.assigneeUserId)
                : "Non attribué"}{" "}
              · Échéance : {followup.dueAt ? fmt(followup.dueAt) : "Aucune"}
            </p>
            <p>
              Modifié par {memberName(followup.updatedByUserId)} le{" "}
              {fmt(followup.updatedAt)}.
            </p>
            {followup.suggestedScanId ? (
              <p className="text-amber-100">
                Ce constat n’a pas été retrouvé dans un scan comparable.{" "}
                <Link
                  className="underline"
                  href={`/organizations/${organizationId}/sites/${siteId}/scans/${followup.suggestedScanId}`}
                >
                  Vérifier ce scan
                </Link>{" "}
                avant de confirmer la correction.
              </p>
            ) : null}
            {followup.reopenedAt ? (
              <p className="text-amber-100">
                Réapparu le {fmt(followup.reopenedAt)} après avoir été marqué
                corrigé.
              </p>
            ) : null}
            {followup.acceptanceReason ? (
              <p>
                Justification du risque accepté : {followup.acceptanceReason}
              </p>
            ) : null}
          </>
        ) : (
          <p>Aucun suivi enregistré pour ce constat.</p>
        )}
        <Link
          className="inline-block text-[#8793ff] underline"
          href={`/organizations/${organizationId}/sites/${siteId}`}
        >
          Relancer un scan depuis la fiche du site
        </Link>
        {canManage ? (
          <form
            action={action}
            onSubmit={(event) => {
              event.preventDefault();
              if (submitting.current || pending) return;
              submitting.current = true;
              submittedRevision.current = noteRevision.current;
              const formData = new FormData(event.currentTarget);
              // Dispatch without the native form reset; keep drafts on refusal.
              startTransition(() => action(formData));
            }}
            aria-busy={pending}
            className="grid gap-3 border-t border-[#303a50] pt-4 sm:grid-cols-2"
          >
            <label>
              Statut
              <select
                name="status"
                className="am-field mt-1"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-invalid={
                  !!state.error && state.error.startsWith("Statut invalide")
                }
                aria-describedby={
                  state.error?.startsWith("Statut invalide")
                    ? errorId
                    : undefined
                }
              >
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Responsable
              <select
                name="assignee"
                className="am-field mt-1"
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
                aria-invalid={
                  !!state.error && state.error.startsWith("Responsable hors")
                }
                aria-describedby={
                  state.error?.startsWith("Responsable hors")
                    ? errorId
                    : undefined
                }
              >
                <option value="">Non attribué</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Échéance
              <input
                name="due"
                type="date"
                className="am-field mt-1"
                value={due}
                onChange={(event) => setDue(event.target.value)}
                aria-invalid={
                  !!state.error && state.error.startsWith("Échéance invalide")
                }
                aria-describedby={
                  state.error?.startsWith("Échéance invalide")
                    ? errorId
                    : undefined
                }
              />
            </label>
            <label className="sm:col-span-2">
              Note ou justification du risque accepté
              <textarea
                name="note"
                maxLength={2000}
                value={note}
                onChange={(event) => {
                  noteRevision.current += 1;
                  setNote(event.target.value);
                }}
                aria-invalid={
                  !!state.error && state.error.startsWith("Une justification")
                }
                aria-describedby={
                  state.error?.startsWith("Une justification")
                    ? errorId
                    : undefined
                }
                className="am-field mt-1 min-h-20"
                placeholder="Obligatoire pour « risque accepté »"
              />
            </label>
            <button disabled={pending} className="am-button-secondary w-fit">
              {pending ? "Enregistrement…" : "Enregistrer le suivi"}
            </button>
            {state.error ? (
              <p id={errorId} role="alert" className="text-red-200">
                {state.error}
              </p>
            ) : state.saved ? (
              <p role="status" className="text-emerald-200">
                Suivi enregistré.
              </p>
            ) : null}
          </form>
        ) : null}
        {events.length > 0 ? (
          <div className="border-t border-[#303a50] pt-3">
            <h5 className="font-semibold">Historique</h5>
            <ul className="mt-2 space-y-2">
              {events.map((event, index) => (
                <li key={index}>
                  {fmt(event.createdAt)} · {memberName(event.actorUserId)} :{" "}
                  {event.eventType === "reopened"
                    ? "réouvert"
                    : event.eventType === "suggested"
                      ? "correction à vérifier"
                      : (labels[event.toStatus] ?? event.toStatus)}
                  {event.note ? ` — ${event.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
