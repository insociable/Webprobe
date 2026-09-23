"use client";

import { useActionState } from "react";
import {
  generateVerificationChallengeAction,
  verifyDnsChallengeAction,
} from "./actions";
import type { VerificationActionState } from "./actions";

const initialVerificationActionState: VerificationActionState = {
  error: null,
  token: null,
  recordName: null,
  expiresAt: null,
};

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
      <div className="am-panel p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
          Étape 1 · Préparer le TXT
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">
          Créer l’enregistrement chez votre fournisseur DNS
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/50">
          Générez d’abord le challenge ci-dessous. Ensuite, connectez-vous au
          site du fournisseur qui gère la zone DNS de votre domaine (OVHcloud,
          Cloudflare, Gandi ou équivalent), ouvrez la rubrique
          <strong className="font-semibold text-white/70">
            {" "}
            Zone DNS / DNS records
          </strong>{" "}
          puis ajoutez un nouvel enregistrement de type TXT.
        </p>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="am-panel-soft p-4">
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
              Type
            </dt>
            <dd className="mt-2 font-mono text-sm font-semibold">TXT</dd>
          </div>
          <div className="am-panel-soft p-4">
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
              Nom / Hôte
            </dt>
            <dd className="mt-2 break-all font-mono text-sm text-white/80">
              {activeRecordName}
            </dd>
          </div>
        </dl>

        {generationState.token ? (
          <>
            <div className="mt-5 border-l-2 border-[#6d7cff] bg-[#0f1421] p-4">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8793ff]">
                Valeur / Contenu à copier
              </p>
              <p className="mt-2 break-all font-mono text-sm text-white/90">
                {generationState.token}
              </p>
              <p className="mt-3 text-xs leading-5 text-white/40">
                Copiez cette valeur exactement, sans guillemets ajoutés. Cette
                valeur brute n’est pas conservée par WebProbe.
              </p>
            </div>

            <ol className="mt-5 space-y-3 text-sm leading-6 text-white/55">
              <li>
                <strong className="text-white/70">1.</strong> Dans votre zone
                DNS, choisissez{" "}
                <strong className="text-white/70">
                  Ajouter un enregistrement
                </strong>
                .
              </li>
              <li>
                <strong className="text-white/70">2.</strong> Sélectionnez le
                type <strong className="text-white/70">TXT</strong>.
              </li>
              <li>
                <strong className="text-white/70">3.</strong> Dans
                <strong className="text-white/70"> Nom / Hôte</strong>, utilisez
                le nom indiqué ci-dessus. Si votre fournisseur ajoute
                automatiquement votre domaine et refuse le nom complet, utilisez
                seulement{" "}
                <code className="font-mono text-xs">_agency-monitor</code>.
              </li>
              <li>
                <strong className="text-white/70">4.</strong> Dans
                <strong className="text-white/70"> Valeur / Contenu</strong>,
                collez le token affiché ci-dessus.
              </li>
              <li>
                <strong className="text-white/70">5.</strong> Laissez le TTL sur
                <strong className="text-white/70">
                  {" "}
                  Auto / valeur par défaut
                </strong>
                , enregistrez, puis revenez ici pour lancer la vérification.
              </li>
            </ol>
          </>
        ) : (
          <p className="mt-4 text-sm leading-6 text-white/45">
            Cliquez sur « Générer le challenge » pour obtenir la valeur TXT à
            publier. Une régénération invalide immédiatement la valeur
            précédente.
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
            className="am-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="am-panel p-6">
        <h2 className="text-xl font-semibold tracking-tight">
          Vérifier la propagation DNS
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/50">
          Après avoir enregistré le TXT chez votre fournisseur DNS, revenez ici
          et lancez la vérification. La propagation peut être quasi immédiate ou
          demander un peu de temps selon le fournisseur et les caches DNS.
        </p>
        <div className="mt-4 border-l-2 border-[#40506d] pl-4 text-xs leading-5 text-white/40">
          Si le TXT n’est pas encore trouvé, attendez puis réessayez avec le
          même challenge. Il n’est pas nécessaire de régénérer une nouvelle
          valeur tant que le challenge n’a pas expiré.
        </div>

        <form action={verifyFormAction} className="mt-5">
          <button
            disabled={verifying}
            className="am-button-primary disabled:cursor-not-allowed disabled:opacity-50"
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
