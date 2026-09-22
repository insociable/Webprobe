"use client";

import { useActionState } from "react";
import {
  createReportShareAction,
  initialReportShareActionState,
  revokeReportShareAction,
  sendReportEmailAction,
} from "./report-share-actions";

type ActiveShare = {
  id: string;
  url: string;
  expiresAt: string;
  createdAt: string;
};

type ReportSharePanelProps = {
  organizationId: string;
  siteId: string;
  scanId: string;
  shares: ActiveShare[];
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(value));
}

export function ReportSharePanel({
  organizationId,
  siteId,
  scanId,
  shares,
}: ReportSharePanelProps) {
  const createAction = createReportShareAction.bind(
    null,
    organizationId,
    siteId,
    scanId,
  );
  const emailAction = sendReportEmailAction.bind(
    null,
    organizationId,
    siteId,
    scanId,
  );
  const [createState, createFormAction, creating] = useActionState(
    createAction,
    initialReportShareActionState,
  );
  const [emailState, emailFormAction, sending] = useActionState(
    emailAction,
    initialReportShareActionState,
  );

  return (
    <section className="border-b border-white/10 py-10">
      <p className="text-sm text-white/45">Partage client</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">
        Rapport partageable
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
        Les liens expirent automatiquement après 7 jours et peuvent être
        révoqués à tout moment.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <form
          action={createFormAction}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
        >
          <h3 className="font-semibold">Créer un lien</h3>
          <p className="mt-2 text-sm text-white/40">
            Crée un accès public temporaire à ce rapport uniquement.
          </p>
          <button
            disabled={creating}
            className="mt-4 rounded-xl bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-950 disabled:opacity-50"
          >
            {creating ? "Création…" : "Créer un lien 7 jours"}
          </button>
          {createState.message ? (
            <p className="mt-3 text-sm text-emerald-200">
              {createState.message}
            </p>
          ) : null}
          {createState.error ? (
            <p className="mt-3 text-sm text-amber-100">{createState.error}</p>
          ) : null}
        </form>

        <form
          action={emailFormAction}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
        >
          <h3 className="font-semibold">Envoyer par e-mail</h3>
          <label className="mt-3 block text-sm text-white/50">
            Destinataire
            <input
              name="recipientEmail"
              type="email"
              required
              autoComplete="email"
              className="mt-2 block w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-white outline-none focus:border-emerald-300/40"
              placeholder="client@example.com"
            />
          </label>
          <button
            disabled={sending}
            className="mt-4 rounded-xl border border-emerald-300/25 px-4 py-2.5 text-sm font-semibold text-emerald-200 disabled:opacity-50"
          >
            {sending ? "Mise en file…" : "Envoyer le rapport"}
          </button>
          {emailState.message ? (
            <p className="mt-3 text-sm text-emerald-200">
              {emailState.message}
            </p>
          ) : null}
          {emailState.error ? (
            <p className="mt-3 text-sm text-amber-100">{emailState.error}</p>
          ) : null}
        </form>
      </div>

      {shares.length > 0 ? (
        <div className="mt-6 space-y-3">
          <h3 className="text-sm font-semibold">Liens actifs</h3>
          {shares.map((share) => {
            const revokeAction = revokeReportShareAction.bind(
              null,
              organizationId,
              siteId,
              scanId,
              share.id,
            );
            return (
              <div
                key={share.id}
                className="rounded-xl border border-white/10 bg-black/10 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <a
                      href={share.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sm text-emerald-200 hover:underline"
                    >
                      {share.url}
                    </a>
                    <p className="mt-1 text-xs text-white/35">
                      Créé le {formatDate(share.createdAt)} · expire le{" "}
                      {formatDate(share.expiresAt)}
                    </p>
                  </div>
                  <form action={revokeAction}>
                    <button className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55 transition hover:border-red-300/30 hover:text-red-200">
                      Révoquer
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
