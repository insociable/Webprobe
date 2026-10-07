"use client";

import { useActionState } from "react";
import { importSitesAction, initialImportState } from "./actions";

const statusLabel = {
  ready: "À importer",
  invalid: "Invalide",
  "duplicate-file": "Doublon du fichier",
  existing: "Déjà présent",
};

export function ImportForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(
    importSitesAction.bind(null, organizationId),
    initialImportState,
  );
  const ready = state.rows.filter((row) => row.status === "ready").length;
  const invalid = state.rows.some((row) => row.status === "invalid");
  return (
    <div className="space-y-6">
      <form action={action} className="am-panel space-y-5 p-6">
        <input type="hidden" name="mode" value="preview" />
        <label className="block space-y-2 text-sm text-[#cdd5e4]">
          <span>Fichier CSV</span>
          <input
            className="am-field"
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
          />
        </label>
        <p className="text-xs leading-5 text-[#8793a8]">
          Modèle : première ligne <code>url,name</code>, puis une URL HTTP(S)
          par ligne et un nom facultatif. Exemple :{" "}
          <code>https://exemple.fr,Site principal</code>. 500 lignes et 512 Ko
          maximum. Aucun scan ni suivi n’est lancé par cet import.
        </p>
        <button className="am-button-primary" disabled={pending}>
          Prévisualiser
        </button>
      </form>
      {state.error && (
        <p role="alert" className="text-sm text-red-200">
          {state.error}
        </p>
      )}
      {state.result && (
        <p role="status" className="am-panel p-5 text-sm">
          {state.result.imported} site(s) ajouté(s), {state.result.skipped}{" "}
          ligne(s) ignorée(s). Aucun scan lancé.
        </p>
      )}
      {state.source !== null && (
        <section className="am-panel p-6">
          <h2 className="text-xl font-semibold">Aperçu avant enregistrement</h2>
          <p className="mt-2 text-sm text-[#8793a8]">
            {ready} à importer · {state.rows.length - ready} ignorée(s)
          </p>
          <div className="mt-5 max-h-[34rem] overflow-auto">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead>
                <tr className="border-b border-[#303a50]">
                  <th className="p-2">Ligne</th>
                  <th className="p-2">URL</th>
                  <th className="p-2">Nom</th>
                  <th className="p-2">Décision</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row) => (
                  <tr key={row.line} className="border-b border-[#242d40]">
                    <td className="p-2">{row.line}</td>
                    <td className="break-all p-2">{row.url}</td>
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">
                      {statusLabel[row.status]}
                      {row.reason ? ` : ${row.reason}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invalid && (
            <p className="mt-4 text-sm text-amber-200">
              Corrigez les lignes invalides avant confirmation.
            </p>
          )}
          <form action={action} className="mt-5 space-y-4">
            <input type="hidden" name="mode" value="confirm" />
            <input type="hidden" name="confirm" value="yes" />
            <textarea
              className="hidden"
              name="source"
              readOnly
              value={state.source}
              aria-hidden="true"
            />
            <button
              className="am-button-primary"
              disabled={pending || invalid || ready === 0}
            >
              Confirmer l’ajout de {ready} site(s)
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
