import {
  scannerV2CrawlLimitation,
  scannerV2Quality,
} from "@/lib/scanner-v2-quality";

const analyzerLabels = {
  crawl: "Crawl / accessibilité",
  network: "Réseau",
  performance: "Performance",
  seo: "SEO",
} as const;

const statusLabels = {
  complete: "Complète",
  partial: "Partielle",
  unavailable: "Non disponible",
} as const;

export function ReportCoverageDetails({ summary }: { summary: unknown }) {
  const quality = scannerV2Quality(summary);
  const crawlLimitation = scannerV2CrawlLimitation(summary);
  if (!quality && !crawlLimitation) return null;

  return (
    <section className="no-print border-b border-[#242d40] py-8">
      <details className="rounded-lg border border-[#242d40] bg-[#0a0f18]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#647188]">
              Couverture de l’audit
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              Détail de la complétude
            </h2>
          </div>
          <span className="text-sm text-[#657188]">Afficher ▾</span>
        </summary>

        <div className="border-t border-[#242d40] px-5 py-5">
          {crawlLimitation ? (
            <p className="mb-5 max-w-3xl text-sm leading-6 text-amber-100/70">
              {crawlLimitation === "robots-restricted"
                ? "robots.txt limite les pages que l’audit public est autorisé à parcourir. Certaines parties du site n’ont donc pas été analysées."
                : "La politique robots.txt n’a pas pu être déterminée de façon fiable. Le crawl profond a été arrêté par précaution."}
            </p>
          ) : null}

          {quality ? (
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(quality).map(([analyzer, status]) => (
                <div
                  key={analyzer}
                  className="rounded-md border border-[#242d40] bg-[#0d111a] p-4"
                >
                  <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#647188]">
                    {analyzerLabels[analyzer as keyof typeof analyzerLabels]}
                  </dt>
                  <dd className="mt-2 text-sm font-semibold text-[#d5dbe7]">
                    {statusLabels[status]}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-[#7f8a9f]">
              La complétude détaillée n’est pas disponible pour ce scan.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
