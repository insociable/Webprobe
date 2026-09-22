"use client";

import { useActionState } from "react";
import {
  generateVerificationChallengeAction,
  initialVerificationActionState,
  verifyDnsChallengeAction,
} from "./actions";

type VerificationPanelProps = {
  organizationId: string;
  siteId: string;
  recordName: string;
  existingExpiresAt: string | null;
};

export function VerificationPanel({
  organizationId,
  siteId,
  recordName,
  existingExpiresAt,
}: VerificationPanelProps) {
  const generateAction = generateVerificationChallengeAction.bind(
    null,
    organizationId,
    siteId,
  );
  const verifyAction = verifyDnsChallengeAction.bind(
    null,
    organizationId,
    siteId,
  );

  const [generationState, generateFormAction, generating] = useActionState(
    generateAction,
    initialVerificationActionState,
  );
  const [verificationState, verifyFormAction, verifying] = useActionState(
    verifyAction,
    initialVerificationActionState,
  );

  const activeRecordName = generationState.recordName ?? recordName;
  const activeExpiresAt =
    generationState.expiresAt ?? existingExpiresAt ?? null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-black/15 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
          Enregistrement TXT
        </p>
        <p className="mt-3 break-all font-mono text-sm text-white/80">
          {activeRecordName}
        </p>

        {generationState.token ? (
          <div className="mt-5 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
              Valeur à copier maintenant
            </p>
            <p className="mt-2 break-all font-mono text-sm text-white/90">
              {generationState.token}
            </p>
            <p className="mt-3 text-xs leading-5 text-white/40">
              Cette valeur brute n’est pas conservée par Agency Monitor.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-white/45">
            Générez un challenge pour obtenir la valeur TXT. Une régénération
            invalide immédiatement la valeur précédente.
          </p>
        )}

        {activeExpiresAt ? (
          <p className="mt-4 text-xs text-white/35">
            Expiration du challenge :{" "}
            {new Date(activeExpiresAt).toLocaleString("fr-FR")}
          </p>
        ) : null}

        <form action={generateFormAction} className="mt-5">
          <button
            disabled={generating}
            className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating
              ? "Génération…"
              : activeExpiresAt
                ? "Régénérer le challenge"
                : "Générer le challenge"}
          </button>
        </form>

        {generationState.error ? (
          <p
            aria-live="polite"
            className="mt-4 rounded-xl border border-red-300/20 bg-red-300/[0.06] px-4 py-3 text-sm text-red-100"
          >
            {generationState.error}
          </p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
        <h2 className="text-xl font-semibold tracking-tight">
          Vérifier la propagation DNS
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/50">
          Après avoir créé le TXT chez votre fournisseur DNS, lancez la
          vérification. Tant que le challenge ne correspond pas, le site reste
          inactif et aucun scan n’est autorisé.
        </p>

        <form action={verifyFormAction} className="mt-5">
          <button
            disabled={verifying}
            className="rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {verifying ? "Vérification…" : "Vérifier le TXT"}
          </button>
        </form>

        {verificationState.error ? (
          <p
            aria-live="polite"
            className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100"
          >
            {verificationState.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
