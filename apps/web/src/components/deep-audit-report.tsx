import {
  deepFindings,
  deepHttpObservationFailed,
  scoreDeepAudit,
} from "../lib/deep-report-metrics";
import { getFindingRemediation } from "../lib/finding-remediation";
import {
  sanitizeReportHeaderValue,
  sanitizeReportUrl,
} from "../lib/report-technical-details";
import { RemediationDetails } from "./remediation-details";
import { CookieConsentDetails } from "./cookie-consent-details";
import { PerformanceReport } from "./performance-report";

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

function safeDisplayText(value: string): string {
  return sanitizeReportHeaderValue(value)
    .replace(/\x27nonce-[^\x27]*\x27/gi, "\x27nonce-[redacted]\x27")
    .replace(/(?:\/|\.\.?\/)[^\s;,"\x27<>?#]+[?#][^\s;,"\x27<>]*/g, (url) =>
      sanitizeReportUrl(url),
    );
}

function safeEvidenceText(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? "";
  return text
    .replace(/\x27nonce-[^\x27]*\x27/gi, "\x27nonce-[redacted]\x27")
    .replace(/https?:\/\/[^\s;,"\x27<>]+/gi, (url) => sanitizeReportUrl(url))
    .replace(/(?:\/|\.\.?\/)[^\s;,"\x27<>?#]+[?#][^\s;,"\x27<>]*/g, (url) =>
      sanitizeReportUrl(url),
    )
    .slice(0, 16_384);
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

  if (checkId === "deep-performance")
    return {
      category: "Performance",
      title: "Performance observée",
      description:
        "Mesures de laboratoire, indépendantes du Score Deep de sécurité.",
    };
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
  "observation-evidence-limited": {
    title: "Preuves partiellement observées",
    detail:
      "Une limite de collecte a tronqué certaines preuves. Les constats disponibles restent visibles ; leur absence ne démontre pas une protection.",
  },
  "observation-evidence-unavailable": {
    title: "Preuves indisponibles",
    detail:
      "Une observation nécessaire n’est pas disponible. Ce contrôle ne conclut pas sur les éléments absents.",
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
  const score = scoreDeepAudit(checkRuns);
  const dedicatedCspCompleted = checkRuns.some(
    (run) => run.checkId === "deep-csp" && run.status === "completed",
  );
  const httpObservationFailed = deepHttpObservationFailed(checkRuns);
  const cspMissing = checkRuns.some((run) => {
    if (run.checkId !== "deep-csp" || run.status !== "completed") return false;
    const data = asRecord(run.evidence[0]?.data);
    return (
      data?.applied === false &&
      data.httpObserved !== false &&
      !httpObservationFailed
    );
  });
  const coverage = asRecord(summary.v3Coverage);
  const budget = coverage ? asRecord(coverage.budgetUsed) : null;
  const browserRun = checkRuns.find(
    (run) =>
      run.checkId === "deep-browser-observation" && run.status === "completed",
  );
  const browserEvidence = asRecord(browserRun?.evidence[0]?.data);
  const documentLinks = asRecord(browserEvidence?.documentLinks);
  const boundedLinkCount = (value: unknown): number | null =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100
      ? value
      : null;
  const sampledLinks = boundedLinkCount(documentLinks?.sampled);
  const inScopeLinks = boundedLinkCount(documentLinks?.inScopeDistinct);
  const externalLinks = boundedLinkCount(documentLinks?.externalDistinct);
  const reasons = Array.isArray(coverage?.reasons)
    ? coverage.reasons.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  // The persisted summary aggregates limits from every check. A partial
  // Performance observation must remain visible in its own section, but does
  // not by itself imply that the security diagnostics were incomplete.
  const performanceLimited = checkRuns.some(
    (run) =>
      run.checkId === "deep-performance" &&
      run.evidence.some(
        (evidence) => asRecord(evidence.data)?.coverage === "limited",
      ),
  );
  const otherV2EvidenceLimited = checkRuns.some(
    (run) =>
      run.checkId !== "deep-performance" &&
      run.checkVersion.startsWith("2.") &&
      run.evidence.some(
        (evidence) => asRecord(evidence.data)?.coverage === "limited",
      ),
  );
  const performanceOnlyEvidenceLimit =
    performanceLimited && !otherV2EvidenceLimited;
  const summaryReasons = reasons.filter(
    (reason) =>
      reason !== "observation-evidence-limited" ||
      !performanceOnlyEvidenceLimit,
  );
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
    status === "completed" &&
    reasons.length === 0 &&
    skipped === 0 &&
    failed === 0 &&
    !score.limitedCoverage;
  const performanceOnlySummaryLimit =
    status === "completed" &&
    performanceOnlyEvidenceLimit &&
    reasons.includes("observation-evidence-limited") &&
    summaryReasons.length === 0 &&
    skipped === 0 &&
    failed === 0 &&
    !score.limitedCoverage;

  return (
    <section className="border-b border-[#242d40] py-10">
      <p className="am-kicker">Audit approfondi</p>
      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">
            Synthèse Deep
          </h2>
          <p className="mt-2 max-w-3xl text-base leading-6 text-white/50">
            WebProbe analyse le domaine vérifié avec des transports HTTP et
            navigateur isolés. Les contrôles restent bornés au périmètre
            autorisé, aux budgets réseau et aux protections anti-SSRF.
          </p>
        </div>
        <span className="rounded-md border border-[#39445d] bg-[#111827] px-3 py-2 text-sm text-[#b6c0d1]">
          {coverageComplete
            ? "Contrôles Deep exécutés"
            : performanceOnlySummaryLimit
              ? "Contrôles exécutés · Performance partielle"
              : "Couverture à vérifier"}
        </span>
      </div>

      <div className="am-panel-soft mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.12em] text-white/40">
              Score Deep · règles v{score.rulesVersion}
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-[-0.04em]">
              {status === "completed" && score.value !== null
                ? `${score.value} / 100`
                : "Non évalué"}
            </p>
          </div>
          <p className="pb-1 text-base font-semibold text-[#b8c2ff]">
            {status === "completed" ? score.label : "Analyse en cours"}
            {score.limitedCoverage && status === "completed"
              ? ` · Couverture partielle (${score.completedControls}/${score.expectedControls} contrôles de diagnostic)`
              : ""}
          </p>
        </div>
        <p className="max-w-xl text-base leading-7 text-white/50 sm:text-right">
          Indice des constats observés, ni pourcentage de sécurité ni
          certification. Les contrôles détaillés font foi. Comparez uniquement
          des scans utilisant la même version de règles.
        </p>
      </div>

      <div className="mt-5 rounded-lg border border-[#39445d] bg-[#111827] p-5">
        <h3 className="text-base font-semibold text-white/90">
          Portée réelle de l’observation navigateur
        </h3>
        <p className="mt-2 text-sm leading-6 text-white/75">
          L’audit Deep ouvre le document d’entrée et observe les ressources
          qu’il charge. Il ne suit pas automatiquement les liens vers d’autres
          pages : un budget autorisant plusieurs pages ne signifie pas qu’elles
          ont été visitées. Une couverture complète des contrôles ne signifie
          donc pas un audit de toutes les pages du site.
        </p>
        {sampledLinks !== null &&
        inScopeLinks !== null &&
        externalLinks !== null ? (
          <p className="mt-2 text-sm leading-6 text-white/75">
            Échantillon de {sampledLinks} lien{sampledLinks > 1 ? "s" : ""} du
            document : {inScopeLinks} destination
            {inScopeLinks > 1 ? "s" : ""} interne
            {inScopeLinks > 1 ? "s" : ""} distincte
            {inScopeLinks > 1 ? "s" : ""} non parcourue
            {inScopeLinks > 1 ? "s" : ""} et {externalLinks} destination
            {externalLinks > 1 ? "s" : ""} externe
            {externalLinks > 1 ? "s" : ""}.
            {documentLinks?.truncated === true
              ? " Échantillon limité aux 100 premiers liens : le total du site est inconnu."
              : " Ce relevé ne constitue pas un inventaire exhaustif du site."}
          </p>
        ) : null}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Contrôles prévus", coverage?.totalChecks ?? checkRuns.length],
          ["Terminés", coverage?.completedChecks ?? completed],
          ["Non exécutés", coverage?.skippedChecks ?? skipped],
          ["Échecs", coverage?.failedChecks ?? failed],
        ].map(([label, value]) => (
          <div key={String(label)} className="am-panel-soft p-4">
            <p className="text-sm uppercase tracking-[0.12em] text-white/35">
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
              <p className="text-sm text-white/35">{String(label)}</p>
              <p className="mt-1 text-base font-medium text-white/70">
                {typeof value === "number" || typeof value === "string"
                  ? String(value)
                  : "—"}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {summaryReasons.length > 0 ? (
        <div className="mt-5 border-l-2 border-amber-300/70 bg-amber-200/[0.05] p-5">
          <p className="text-base font-semibold text-amber-100">
            Certaines limites ont réduit la couverture
          </p>
          <div className="mt-3 space-y-3">
            {summaryReasons.map((reason) => {
              const copy = reasonLabels[reason] ?? {
                title: "Limite technique rencontrée",
                detail:
                  "Une limite interne a restreint une partie de l’analyse. Le détail technique reste disponible ci-dessous.",
              };
              return (
                <div key={reason}>
                  <p className="text-base font-medium text-amber-100 opacity-90">
                    {copy.title}
                  </p>
                  <p className="mt-1 text-base leading-6 text-amber-100 opacity-70">
                    {copy.detail}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : coverageComplete ? (
        <div className="mt-5 border-l-2 border-emerald-300/60 bg-emerald-200/[0.04] p-4">
          <p className="text-base text-emerald-100 opacity-75">
            Tous les contrôles prévus ont été exécutés dans le périmètre et les
            budgets autorisés.
          </p>
        </div>
      ) : null}

      <div className="mt-8">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-[#647188]">
          Ce qui a été analysé
        </p>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          {checkRuns.length === 0 ? (
            <div className="border-l-2 border-[#46557a] bg-[#0d121d] p-6 lg:col-span-2">
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
                <div className="mt-3 grid gap-4">
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
                    const findings = deepFindings(
                      run,
                      dedicatedCspCompleted,
                      httpObservationFailed,
                    );
                    const cookieConsent =
                      run.checkId === "deep-cookies"
                        ? asRecord(evidenceData?.cookieConsent)
                        : null;
                    const evidenceCoverage =
                      typeof evidenceData?.coverage === "string"
                        ? evidenceData.coverage
                        : null;
                    const cspUnavailable =
                      run.checkId === "deep-csp" &&
                      (evidenceData?.httpObserved === false ||
                        httpObservationFailed);
                    return (
                      <article
                        key={run.id}
                        className="rounded-lg border border-[#242d40] bg-[#0d111a] p-5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h4 className="font-semibold">{userTitle}</h4>
                            <p className="mt-2 text-base leading-6 text-white/45">
                              {safeDisplayText(userSummary)}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-md border border-[#39445d] px-2.5 py-1 font-mono text-xs uppercase tracking-[0.1em] text-[#b6c0d1]">
                            {statusLabels[run.status] ??
                              humanizeIdentifier(run.status)}
                          </span>
                        </div>

                        {highlights.length > 0 ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {highlights.map((item) => (
                              <span
                                key={item}
                                className="rounded-md border border-[#303a50] bg-[#111827] px-2.5 py-1 text-sm text-[#aeb9cc]"
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {skipCopy ? (
                          <p className="mt-4 text-base leading-6 text-amber-100 opacity-70">
                            {skipCopy.detail}
                          </p>
                        ) : null}

                        {run.checkId !== "deep-performance" &&
                        (evidenceCoverage === "limited" ||
                          evidenceCoverage === "unavailable") ? (
                          <p className="mt-4 text-base leading-6 text-amber-100 opacity-75">
                            {evidenceCoverage === "limited"
                              ? "Couverture partielle : certaines preuves sont tronquées ou hors limite ; aucun résultat favorable ne peut en être déduit."
                              : "Observation indisponible : ce contrôle ne conclut pas sur les éléments absents."}
                          </p>
                        ) : null}

                        {run.checkId === "deep-performance" ? (
                          <PerformanceReport observation={evidenceData} />
                        ) : null}
                        <CookieConsentDetails
                          observation={cookieConsent}
                          observedAt={run.startedAt}
                        />

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
                                  ? safeDisplayText(finding.summary)
                                  : "Observation technique";
                              const code =
                                typeof finding.code === "string"
                                  ? finding.code
                                  : "finding";
                              const recommendation =
                                typeof finding.recommendation === "string"
                                  ? safeDisplayText(finding.recommendation)
                                  : null;
                              const observed =
                                typeof finding.observed === "string" ||
                                typeof finding.observed === "number" ||
                                typeof finding.observed === "boolean"
                                  ? safeDisplayText(String(finding.observed))
                                  : null;
                              const remediation = getFindingRemediation(code);
                              return (
                                <div
                                  key={code + "-" + index}
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
                                    <p className="text-base font-medium text-white/80">
                                      {summary}
                                    </p>
                                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
                                      {level === "risk"
                                        ? "À corriger"
                                        : level === "review"
                                          ? "À vérifier"
                                          : "Information"}
                                    </span>
                                  </div>
                                  <RemediationDetails
                                    remediation={remediation}
                                    fallback={recommendation}
                                    verification={
                                      remediation
                                        ? null
                                        : "Relancez un audit approfondi après correction pour confirmer que le signal a disparu."
                                    }
                                  />

                                  <details className="mt-3 rounded-md border border-[#29344b] bg-black/10">
                                    <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-[#8793ff] [&::-webkit-details-marker]:hidden">
                                      Détails techniques
                                    </summary>
                                    <dl className="grid gap-3 border-t border-[#242d40] px-3 py-3 sm:grid-cols-2">
                                      <div>
                                        <dt className="text-sm text-white/30">
                                          Code
                                        </dt>
                                        <dd className="mt-1 break-all font-mono text-sm text-white/55">
                                          {code}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="text-sm text-white/30">
                                          Valeur observée
                                        </dt>
                                        <dd className="mt-1 break-all text-sm text-white/55">
                                          {observed ?? "—"}
                                        </dd>
                                      </div>
                                    </dl>
                                    <pre className="mx-3 mb-3 overflow-x-auto rounded-md bg-black/20 p-3 text-sm leading-5 text-white/55">
                                      {safeEvidenceText(finding)}
                                    </pre>
                                  </details>
                                </div>
                              );
                            })}
                          </div>
                        ) : cspUnavailable ? (
                          <p className="mt-4 text-base text-amber-100 opacity-75">
                            Politique CSP non évaluée : réponse HTTP
                            indisponible.
                          </p>
                        ) : run.checkId === "deep-security-headers" &&
                          cspMissing ? (
                          <p className="mt-4 text-base text-white/55">
                            Le diagnostic de la CSP figure dans le contrôle
                            Politique CSP.
                          </p>
                        ) : cookieConsent ||
                          evidenceCoverage === "limited" ||
                          evidenceCoverage ===
                            "unavailable" ? null : run.status ===
                          "completed" ? (
                          <p className="mt-4 text-base text-emerald-100 opacity-75">
                            Aucun point nécessitant une action n’a été relevé
                            par ce contrôle.
                          </p>
                        ) : null}

                        <details className="mt-5 border-t border-[#242d40] pt-4">
                          <summary className="cursor-pointer text-sm font-semibold text-[#8793ff]">
                            Détails techniques du contrôle
                          </summary>
                          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div>
                              <dt className="text-sm text-white/30">
                                Identifiant interne
                              </dt>
                              <dd className="mt-1 break-all font-mono text-sm text-white/55">
                                {run.checkId} · v{run.checkVersion}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-sm text-white/30">
                                Page observée
                              </dt>
                              <dd className="mt-1 break-all text-sm text-white/55">
                                {typeof evidenceData?.pageUrl === "string"
                                  ? sanitizeReportUrl(evidenceData.pageUrl)
                                  : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-sm text-white/30">Date</dt>
                              <dd className="mt-1 text-sm text-white/55">
                                {run.startedAt.toLocaleString("fr-FR", {
                                  timeZone: "UTC",
                                })}{" "}
                                UTC
                              </dd>
                            </div>
                            <div>
                              <dt className="text-sm text-white/30">Durée</dt>
                              <dd className="mt-1 text-sm text-white/55">
                                {run.durationMs === null
                                  ? "—"
                                  : run.durationMs + " ms"}
                              </dd>
                            </div>
                          </dl>
                          {Object.keys(run.budgetUsed).length > 0 ? (
                            <pre className="mt-3 overflow-x-auto rounded-md bg-black/20 p-3 text-sm leading-5 text-white/55">
                              {JSON.stringify(run.budgetUsed, null, 2)}
                            </pre>
                          ) : null}
                          {run.evidence.length > 0 ? (
                            <pre className="mt-3 overflow-x-auto rounded-md bg-black/20 p-3 text-sm leading-5 text-white/55">
                              {safeEvidenceText(run.evidence)}
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

      <p className="mt-7 max-w-4xl text-sm leading-5 text-white/35">
        Limites : l’audit Deep reste non destructif. Les destinations hors du
        domaine autorisé, les protocoles non prévus et les opérations réseau
        dépassant les budgets sont bloqués par conception.
      </p>
    </section>
  );
}
