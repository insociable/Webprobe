export function ReportRecommendationCounts({
  counts,
}: {
  counts: { fix: number; improve: number; consider: number };
}) {
  const items = [
    { label: "À corriger", value: counts.fix },
    { label: "À améliorer", value: counts.improve },
    { label: "À envisager", value: counts.consider },
  ];

  return (
    <section className="border-b border-[#242d40] py-6">
      <dl className="grid overflow-hidden rounded-lg border border-[#242d40] sm:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="border-b border-[#242d40] px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#647188]">
              {item.label}
            </dt>
            <dd className="mt-2 text-2xl font-semibold text-[#e5eaf3]">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
