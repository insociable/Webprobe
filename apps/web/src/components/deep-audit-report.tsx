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

type CheckPresentation = {
  category: string;
  title: string;
  description: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function humanizeIdentifier(value: string): string {
  const text = value
    .replace(/^deep-/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Contrôle Deep";
}

function presentationFor(checkId: string): CheckPresentation {
  if (checkId === "deep-http-observation") {
    return {
      category: "HTTP",
      title: "Analyse HTTP approfondie",
      description:
        "Observe la réponse HTTP principale et son parcours de redirection.",
    };
  }
  if (checkId === "deep-browser-observation") {
    return {
      category: "Navigateur",
      title: "Analyse navigateur approfondie",
      description:
        "Charge la page dans un navigateur isolé et borné pour observer son comportement réel.",
    };
  }

  const id = checkId.toLowerCase();
  const candidates: Array<[string[], string]> = [
    [["tls", "certificate"], "TLS avancé"],
    [["cookie"], "Cookies"],
    [["csp"], "Content Security Policy"],
    [["header"], "En-têtes HTTP"],
    [["resource", "asset"], "Ressources"],
    [["endpoint", "route"], "Endpoints"],
    [["form"], "Formulaires"],
  ];
  const category =
    candidates.find(([tokens]) =>
      tokens.some((token) => id.includes(token)),
    )?.[1] ?? "Autres contrôles";
  return {
    category,
    title: humanizeIdentifier(checkId),
    description: "Contrôle technique approfondi du périmètre autorisé.",
  };
}

const statusLabels: Record<string, string> = {
  completed: "Terminé",
  skipped: "Non exécuté",
  failed: "Échec",
};

const reasonLabels: Record<string, { title: string; detail: string }> = {
  "scope-denied": {
    title: "Périmètre de sécurité atteint",
    detail:
      "Une requête ou une navigation a visé une origine hors du périmètre autorisé. WebProbe l’a bloquée par sécurité ; cette partie n’a pas été analysée.",
  },
  "authorization-unavailable": {
    title: "Autorisation indisponible",
    detail: "L’autorisation Deep n’était plus valide au moment du contrôle.",
  },
  "observation-unavailable": {
    title: "Observation indisponible",
    detail: "Une donnée nécessaire au contrôle n’a pas pu être collectée.",
  },
  "transport-timeout": {
    title: "Délai réseau dépassé",
    detail: "Une partie de l’analyse n’a pas répondu dans le temps imparti.",
  },
  "transport-failed": {
    title: "Collecte réseau incomplète",
    detail: "Une opération réseau bornée n’a pas pu être menée à son terme.",
  },
  "dns-failed": {
    title: "Résolution DNS incomplète",
    detail: "Une résolution DNS nécessaire à l’analyse n’a pas abouti.",
  },
  "ssrf-denied": {
    title: "Destination réseau bloquée",
    detail:
      "Une destination non publique ou non autorisée a été refusée par les protections réseau.",
  },
  "budget-time": {
    title: "Temps d’analyse maximal atteint",
    detail:
      "Le budget de durée du Deep a été atteint avant la fin de toutes les observations.",
  },
  "budget-bytes-transferred": {
    title: "Volume maximal atteint",
    detail: "La limite de données analysées a été atteinte.",
  },
  "budget-host-requests": {
    title: "Limite de requêtes par hôte atteinte",
    detail:
      "Le nombre maximal de requêtes autorisées vers un même hôte a été atteint.",
  },
  "budget-http-requests": {
    title: "Limite de requêtes HTTP atteinte",
    detail: "Le nombre maximal de requêtes HTTP du Deep a été atteint.",
  },
  "scan-interrupted": {
    title: "Analyse interrompue",
    detail: "Le scan a été interrompu avant la fin de ce contrôle.",
  },
};

function formatBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "—";
  if (value < 1024) return value + " o";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " Ko";
  return (value / (1024 * 1024)).toFixed(1) + " Mo";
}

function evidenceHighlights(run: DeepCheckRunView): string[] {
  const highlights: string[] = [];
  for (const evidence of run.evidence) {
    const data = asRecord(evidence.data);
    if (!data) continue;
    if (typeof data.statusCode === "number") {
      highlights.push("Réponse HTTP " + data.statusCode);
    }
    if (typeof data.redirects === "number") {
      highlights.push(
        data.redirects === 0
          ? "Aucune redirection"
          : data.redirects + " redirection" + (data.redirects > 1 ? "s" : ""),
      );
    }
    if (typeof data.pageCount === "number") {
      highlights.push(
        data.pageCount +
          " page" +
          (data.pageCount > 1 ? "s" : "") +
          " observée" +
          (data.pageCount > 1 ? "s" : ""),
      );
    }
  }
  return [...new Set(highlights)];
}

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
  const completed = checkRuns.filter(
    (run) => run.status === "completed",
  ).length;
  const skipped = checkRuns.filter((run) => run.status === "skipped").length;
  const failed = checkRuns.filter((run) => run.status === "failed").length;

  const groups = checkRuns.reduce<Map<string, DeepCheckRunView[]>>(
    (map, run) => {
      const category = presentationFor(run.checkId).category;
      map.set(category, [...(map.get(category) ?? []), run]);
      return map;
    },
    new Map(),
  );

  const coverageComplete =
    status === "completed" && reasons.length === 0 && failed === 0;

  return (
    <section className="border-b border-[#242d40] py-10">
      <p className="am-kicker">Audit approfondi</p>
      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">
            Synthèse Deep
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/50">
            WebProbe analyse le domaine vérifié avec des transports HTTP et
            navigateur isolés. Les contrôles restent bornés au périmètre
            autorisé, aux budgets réseau et aux protections anti-SSRF.
          </p>
        </div>
        <span className="rounded-md border border-[#39445d] bg-[#111827] px-3 py-2 text-xs text-[#b6c0d1]">
          {coverageComplete
            ? "Couverture complète du périmètre"
            : "Couverture à vérifier"}
        </span>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Contrôles prévus", coverage?.totalChecks ?? checkRuns.length],
          ["Terminés", coverage?.completedChecks ?? completed],
          ["Non exécutés", coverage?.skippedChecks ?? skipped],
          ["Échecs", coverage?.failedChecks ?? failed],
        ].map(([label, value]) => (
          <div key={String(label)} className="am-panel-soft p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-white/35">
              {String(label)}
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {typeof value === "number" ? value : "—"}
            </p>
          </div>
        ))}
      </div>

      {budget ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Requêtes HTTP", budget.httpRequests],
            ["Résolutions DNS", budget.dnsQueries],
            ["Connexions TLS", budget.tlsHandshakes],
            ["Données analysées", formatBytes(budget.bytesTransferred)],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-[#242d40] bg-[#0d111a] p-4"
            >
              <p className="text-xs text-white/35">{String(label)}</p>
              <p className="mt-1 text-sm font-medium text-white/70">
                {typeof value === "number" || typeof value === "string"
                  ? String(value)
                  : "—"}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {reasons.length > 0 ? (
        <div className="mt-5 border-l-2 border-amber-300/70 bg-amber-200/[0.05] p-5">
          <p className="text-sm font-semibold text-amber-100">
            Certaines limites ont réduit la couverture
          </p>
          <div className="mt-3 space-y-3">
            {reasons.map((reason) => {
              const copy = reasonLabels[reason] ?? {
                title: "Limite technique rencontrée",
                detail:
                  "Une limite interne a restreint une partie de l’analyse. Le détail technique reste disponible ci-dessous.",
              };
              return (
                <div key={reason}>
                  <p className="text-sm font-medium text-amber-100/90">
                    {copy.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-amber-100/60">
                    {copy.detail}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : status === "completed" ? (
        <div className="mt-5 border-l-2 border-emerald-300/60 bg-emerald-200/[0.04] p-4">
          <p className="text-sm text-emerald-100/75">
            Tous les contrôles prévus ont été exécutés dans le périmètre et les
            budgets autorisés.
          </p>
        </div>
      ) : null}

      <div className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
          Ce qui a été analysé
        </p>
        <div className="mt-4 space-y-6">
          {checkRuns.length === 0 ? (
            <div className="border-l-2 border-[#46557a] bg-[#0d121d] p-6">
              <p className="text-white/55">
                {status === "queued" || status === "running"
                  ? "Les résultats apparaîtront ici au fur et à mesure de l’analyse."
                  : "Aucun contrôle Deep n’a été enregistré."}
              </p>
            </div>
          ) : (
            [...groups.entries()].map(([category, runs]) => (
              <section key={category}>
                <h3 className="text-lg font-semibold">{category}</h3>
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  {runs.map((run) => {
                    const presentation = presentationFor(run.checkId);
                    const highlights = evidenceHighlights(run);
                    const skipCopy = run.skipReason
                      ? reasonLabels[run.skipReason]
                      : null;
                    const firstEvidence = run.evidence[0];
                    const evidenceData = firstEvidence
                      ? asRecord(firstEvidence.data)
                      : null;
                    const userTitle =
                      typeof evidenceData?.title === "string"
                        ? evidenceData.title
                        : presentation.title;
                    const userSummary =
                      typeof evidenceData?.summary === "string"
                        ? evidenceData.summary
                        : presentation.description;
                    const findings = Array.isArray(evidenceData?.findings)
                      ? evidenceData.findings
                          .map(asRecord)
                          .filter(
                            (item): item is Record<string, unknown> =>
                              item !== null,
                          )
                      : [];
                    return (
                      <article
                        key={run.id}
                        className="rounded-lg border border-[#242d40] bg-[#0d111a] p-5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h4 className="font-semibold">{userTitle}</h4>
                            <p className="mt-2 text-sm leading-6 text-white/45">
                              {userSummary}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-md border border-[#39445d] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#b6c0d1]">
                            {statusLabels[run.status] ??
                              humanizeIdentifier(run.status)}
                          </span>
                        </div>

                        {highlights.length > 0 ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {highlights.map((item) => (
                              <span
                                key={item}
                                className="rounded-md border border-[#303a50] bg-[#111827] px-2.5 py-1 text-xs text-[#aeb9cc]"
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {skipCopy ? (
                          <p className="mt-4 text-sm leading-6 text-amber-100/65">
                            {skipCopy.detail}
                          </p>
                        ) : null}

                        {findings.length > 0 ? (
                          <div className="mt-4 space-y-2">
                            {findings.map((finding, index) => {
                              const level =
                                finding.level === "risk" ||
                                finding.level === "review" ||
                                finding.level === "information"
                                  ? finding.level
                                  : "information";
                              const summary =
                                typeof finding.summary === "string"
                                  ? finding.summary
                                  : "Observation technique";
                              const recommendation =
                                typeof finding.recommendation === "string"
                                  ? finding.recommendation
                                  : null;
                              const observed =
                                typeof finding.observed === "string" ||
                                typeof finding.observed === "number" ||
                                typeof finding.observed === "boolean"
                                  ? String(finding.observed)
                                  : null;
                              return (
                                <div
                                  key={
                                    (typeof finding.code === "string"
                                      ? finding.code
                                      : "finding") +
                                    "-" +
                                    index
                                  }
                                  className={
                                    "rounded-md border px-3 py-3 " +
                                    (level === "risk"
                                      ? "border-red-400/20 bg-red-400/[0.05]"
                                      : level === "review"
                                        ? "border-amber-300/20 bg-amber-200/[0.04]"
                                        : "border-[#303a50] bg-black/10")
                                  }
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <p className="text-sm font-medium text-white/80">
                                      {summary}
                                    </p>
                                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-white/35">
                                      {level === "risk"
                                        ? "À corriger"
                                        : level === "review"
                                          ? "À vérifier"
                                          : "Information"}
                                    </span>
                                  </div>
                                  {observed ? (
                                    <p className="mt-1 break-all text-xs text-white/45">
                                      Observé : {observed}
                                    </p>
                                  ) : null}
                                  {recommendation ? (
                                    <p className="mt-2 text-xs leading-5 text-white/55">
                                      {recommendation}
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : run.status === "completed" ? (
                          <p className="mt-4 text-sm text-emerald-100/65">
                            Aucun point nécessitant une action n’a été relevé
                            par ce contrôle.
                          </p>
                        ) : null}

                        <details className="mt-5 border-t border-[#242d40] pt-4">
                          <summary className="cursor-pointer text-xs font-semibold text-[#8793ff]">
                            Détails techniques
                          </summary>
                          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div>
                              <dt className="text-xs text-white/30">
                                Identifiant interne
                              </dt>
                              <dd className="mt-1 break-all font-mono text-xs text-white/55">
                                {run.checkId} · v{run.checkVersion}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-white/30">Durée</dt>
                              <dd className="mt-1 text-xs text-white/55">
                                {run.durationMs === null
                                  ? "—"
                                  : run.durationMs + " ms"}
                              </dd>
                            </div>
                          </dl>
                          {Object.keys(run.budgetUsed).length > 0 ? (
                            <pre className="mt-3 overflow-x-auto rounded-md bg-black/20 p-3 text-xs leading-5 text-white/55">
                              {JSON.stringify(run.budgetUsed, null, 2)}
                            </pre>
                          ) : null}
                          {run.evidence.length > 0 ? (
                            <pre className="mt-3 overflow-x-auto rounded-md bg-black/20 p-3 text-xs leading-5 text-white/55">
                              {JSON.stringify(run.evidence, null, 2)}
                            </pre>
                          ) : null}
                        </details>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      <p className="mt-7 max-w-4xl text-xs leading-5 text-white/35">
        Limites : l’audit Deep reste non destructif. Les destinations hors du
        domaine autorisé, les protocoles non prévus et les opérations réseau
        dépassant les budgets sont bloqués par conception.
      </p>
    </section>
  );
}
