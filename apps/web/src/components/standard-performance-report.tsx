import { PerformanceReport } from "./performance-report";
function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
export function StandardPerformanceReport({
  summary,
}: {
  summary: Record<string, unknown>;
}) {
  const performance = record(record(summary.scannerV2).performance);
  if (
    performance.metricVersion !== "2.0.0" ||
    !Array.isArray(performance.pages)
  )
    return null;
  const pages = performance.pages.slice(0, 5);
  return (
    <section className="min-w-0 border-t border-[#242d40] py-9">
      <h2 className="text-xl font-semibold">Performance observée</h2>
      <p className="mt-2 text-sm text-white/50">
        Détails bornés à {pages.length} pages sur{" "}
        {typeof performance.observedPageCount === "number"
          ? performance.observedPageCount
          : "—"}{" "}
        pages observées. Les anciens rapports sans mesures v2 ne sont pas
        réévalués.
      </p>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {pages.map((p, i) => (
          <article
            className="min-w-0 rounded-lg border border-[#242d40] p-5"
            key={i}
          >
            <PerformanceReport observation={p} />
          </article>
        ))}
      </div>
    </section>
  );
}
