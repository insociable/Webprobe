export function ReportAffectedPages({
  occurrenceCount,
  pageUrls,
}: {
  occurrenceCount: number;
  pageUrls: string[];
}) {
  const previewUrls = pageUrls.slice(0, 4);
  const remainingUrls = pageUrls.slice(4);

  return (
    <div className="mt-3">
      <span className="inline-flex rounded-md border border-[#40506d] bg-[#121a28] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#b8c6dc]">
        {occurrenceCount} occurrence{occurrenceCount > 1 ? "s" : ""} ·{" "}
        {pageUrls.length} page{pageUrls.length > 1 ? "s" : ""} / ressource
        {pageUrls.length > 1 ? "s" : ""}
      </span>

      <ul className="no-print mt-3 space-y-1.5 text-sm text-white/40">
        {previewUrls.map((pageUrl) => (
          <li key={pageUrl} className="break-all">
            {pageUrl}
          </li>
        ))}
      </ul>

      {remainingUrls.length > 0 ? (
        <details className="no-print mt-3 rounded-md border border-[#2b364d] bg-[#0b1019] px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-[#9ba7bc]">
            Voir les {remainingUrls.length} autres pages / ressources
          </summary>
          <ul className="mt-3 space-y-1.5 text-sm text-[#6f7b91]">
            {remainingUrls.map((pageUrl) => (
              <li key={pageUrl} className="break-all">
                {pageUrl}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="print-only report-print-pages">
        <p className="report-print-pages-title">
          Pages / ressources concernées
        </p>
        <ul>
          {pageUrls.map((pageUrl) => (
            <li key={pageUrl}>{pageUrl}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
