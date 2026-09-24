type DeepCheckRunView = {
  id: string;
  checkId: string;
  checkVersion: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  budgetUsed: Record<string, number>;
  evidence: ReadonlyArray<Record<string, unknown>>;
  skipReason: string | null;
};

type DeepAuditReportProps = {
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  summary: Record<string, unknown>;
  checkRuns: DeepCheckRunView[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

const statusLabels: Record<string, string> = {
  completed: "Terminé",
  skipped: "Ignoré",
  failed: "Échec",
};
export function DeepAuditReport({
  status,
  summary,
  checkRuns,
}: DeepAuditReportProps) {
  const coverage = asRecord(summary.v3Coverage);
  const budget = coverage ? asRecord(coverage.budgetUsed) : null;
  const reasons = Array.isArray(coverage?.reasons)
    ? coverage.reasons.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const coverageMetrics: Array<[string, unknown]> = coverage
    ? [
        ["Checks prévus", coverage.totalChecks],
        ["Terminés", coverage.completedChecks],
        ["Ignorés", coverage.skippedChecks],
        ["Échoués", coverage.failedChecks],
      ]
    : [];

  return (
    <section className="border-b border-[#242d40] py-10">
      <p className="am-kicker">Moteur Deep V3</p>
      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">
            Audit approfondi
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/50">
            Ce scan utilise la vérification DNS déjà associée au site. Les
            transports HTTP et navigateur restent bornés par le scope, les
            budgets réseau et les protections anti-SSRF du moteur V3.
          </p>
        </div>
        <span className="rounded-md border border-[#39445d] bg-[#111827] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#aeb9cc]">
          {checkRuns.length} check{checkRuns.length > 1 ? "s" : ""}
        </span>
      </div>

      {coverage ? (
        <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {coverageMetrics.map(([label, value]) => (
            <div key={label} className="am-panel-soft p-4">
              <dt className="text-xs uppercase tracking-[0.12em] text-white/35">
                {label}
              </dt>
              <dd className="mt-2 text-2xl font-semibold">
                {typeof value === "number" ? value : "—"}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {budget && Object.keys(budget).length > 0 ? (
        <div className="mt-5 rounded-lg border border-[#242d40] bg-[#0d111a] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
            Budget consommé
          </p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(budget).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs text-white/35">{key}</dt>
                <dd className="mt-1 text-sm text-white/70">
                  {formatValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {reasons.length > 0 ? (
        <div className="mt-5 border-l-2 border-amber-300/70 bg-amber-200/[0.05] p-4">
          <p className="text-sm font-semibold text-amber-100">
            Couverture partielle
          </p>
          <p className="mt-1 text-sm text-amber-100/65">
            {reasons.join(" · ")}
          </p>
        </div>
      ) : null}

      {checkRuns.length === 0 ? (
        <div className="mt-6 border-l-2 border-[#46557a] bg-[#0d121d] p-6">
          <p className="text-white/55">
            {status === "queued" || status === "running"
              ? "Les checks apparaîtront ici au fur et à mesure de la finalisation du scan."
              : "Aucun résultat de check V3 n’a été enregistré."}
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {checkRuns.map((run) => (
            <article
              key={run.id}
              className="rounded-lg border border-[#242d40] bg-[#0d111a] p-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8793ff]">
                    {run.checkId} · v{run.checkVersion}
                  </p>
                  <h3 className="mt-2 font-semibold">
                    {run.checkId === "deep-http-observation"
                      ? "Observation HTTP approfondie"
                      : run.checkId === "deep-browser-observation"
                        ? "Observation navigateur approfondie"
                        : run.checkId}
                  </h3>
                </div>
                <span className="rounded-md border border-[#39445d] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#b6c0d1]">
                  {statusLabels[run.status] ?? run.status}
                </span>
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs text-white/35">Durée</dt>
                  <dd className="mt-1 text-sm text-white/70">
                    {run.durationMs === null ? "—" : `${run.durationMs} ms`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/35">Motif</dt>
                  <dd className="mt-1 text-sm text-white/70">
                    {run.skipReason ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/35">Budget du check</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-white/60">
                    {Object.keys(run.budgetUsed).length
                      ? JSON.stringify(run.budgetUsed)
                      : "—"}
                  </dd>
                </div>
              </dl>

              {run.evidence.length > 0 ? (
                <div className="mt-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                    Preuves techniques
                  </p>
                  <div className="mt-3 space-y-2">
                    {run.evidence.map((item, index) => (
                      <pre
                        key={index}
                        className="overflow-x-auto rounded-md bg-black/20 p-3 text-xs leading-5 text-white/65"
                      >
                        {formatValue(item)}
                      </pre>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
