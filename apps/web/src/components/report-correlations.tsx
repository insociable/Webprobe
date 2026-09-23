import type { ReportCorrelation } from "@/lib/report-correlations";

const priorityLabels = {
  medium: "Priorité moyenne",
  high: "Priorité élevée",
} as const;

export function ReportCorrelations({
  correlations,
}: {
  correlations: readonly ReportCorrelation[];
}) {
  if (correlations.length === 0) return null;

  return (
    <section className="border-b border-[#242d40] py-10">
      <p className="am-kicker">Insights croisés</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
        Signaux à lire ensemble
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7f8a9f]">
        Ces conclusions ne sont affichées que lorsque plusieurs observations
        réelles permettent une lecture plus utile du site.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {correlations.map((correlation) => (
          <article
            key={correlation.id}
            className="rounded-lg border border-[#2a3550] bg-[#0d121d] p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-[#e4e9f2]">
                {correlation.title}
              </h3>
              <span className="rounded-md border border-[#3b4864] bg-[#121827] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#aab5c8]">
                {priorityLabels[correlation.priority]}
              </span>
            </div>

            <p className="mt-3 text-sm leading-6 text-[#8f9aaf]">
              {correlation.summary}
            </p>

            <ul className="mt-4 border-t border-[#242d40] pt-4 text-xs leading-5 text-[#6f7b91]">
              {correlation.evidence.map((evidence) => (
                <li key={evidence}>• {evidence}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
