import { getSafeReportTechnicalDetails } from "@/lib/report-technical-details";

export function ReportTechnicalDetails({ summary }: { summary: unknown }) {
  const details = getSafeReportTechnicalDetails(summary);
  if (!details) return null;

  return (
    <section className="no-print border-b border-[#242d40] py-10">
      <details className="rounded-lg border border-[#242d40] bg-[#0a0f18]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#647188]">
              Niveau technique
            </p>
            <h2 className="mt-1 text-lg font-semibold">Détails techniques</h2>
          </div>
          <span className="text-sm text-[#657188]">Afficher ▾</span>
        </summary>

        <div className="border-t border-[#242d40] px-5 py-6">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="am-panel-soft p-4">
              <dt className="text-xs text-white/35">Statut HTTP</dt>
              <dd className="mt-2 font-semibold">
                {details.http.statusCode ?? "Non disponible"}
              </dd>
            </div>
            <div className="am-panel-soft p-4">
              <dt className="text-xs text-white/35">Durée HTTP</dt>
              <dd className="mt-2 font-semibold">
                {details.http.durationMs !== null
                  ? String(details.http.durationMs) + " ms"
                  : "Non disponible"}
              </dd>
            </div>
            <div className="am-panel-soft p-4 sm:col-span-2">
              <dt className="text-xs text-white/35">URL finale normalisée</dt>
              <dd className="mt-2 break-all text-sm font-medium">
                {details.http.finalUrl ?? "Non disponible"}
              </dd>
            </div>
          </dl>

          {details.http.tls ? (
            <div className="mt-6">
              <h3 className="font-semibold">TLS</h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Protocole", details.http.tls.protocol],
                  ["Chiffrement", details.http.tls.cipher],
                  ["Valide depuis", details.http.tls.validFrom],
                  ["Valide jusqu’au", details.http.tls.validTo],
                ].map(([label, value]) => (
                  <div key={label} className="border-t border-[#242d40] pt-3">
                    <dt className="text-xs text-[#647188]">{label}</dt>
                    <dd className="mt-1 break-all text-sm text-[#b7c0d1]">
                      {value ?? "Non disponible"}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div className="mt-7">
            <h3 className="font-semibold">Headers HTTP</h3>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[#647188]">
              Seuls les headers explicitement autorisés pour le rapport sont
              affichés. Cookies, Authorization, credentials et paramètres de
              requête ne sont jamais exposés ici.
            </p>

            {details.http.headers.length > 0 ? (
              <dl className="mt-4 space-y-3">
                {details.http.headers.map((header) => (
                  <div
                    key={header.name}
                    className="rounded-md border border-[#242d40] bg-[#070a10] p-4"
                  >
                    <dt className="font-mono text-[10px] text-[#8793ff]">
                      {header.name}:
                    </dt>
                    <dd className="mt-2 break-all font-mono text-xs leading-5 text-[#9ba7ba]">
                      {header.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-4 text-sm text-[#7f8a9f]">
                Aucun header technique autorisé n’a été conservé pour ce scan.
              </p>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
