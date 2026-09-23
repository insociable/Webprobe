import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductMark } from "@/components/product-mark";
import { ReportAffectedPages } from "@/components/report-affected-pages";
import { ReportActionPlan } from "@/components/report-action-plan";
import { ReportCorrelations } from "@/components/report-correlations";
import { ReportCoverageDetails } from "@/components/report-coverage-details";
import { ReportRecommendationCounts } from "@/components/report-recommendation-counts";
import { ReportSecurityHttp } from "@/components/report-security-http";
import { ReportTechnicalDetails } from "@/components/report-technical-details";
import { ReportScorecard } from "@/components/report-scorecard";
import { getFindingRemediation } from "@/lib/finding-remediation";
import { groupFindingsForDisplay } from "@/lib/finding-display";
import {
  getFindingBusinessContext,
  getFindingDisplayTitle,
} from "@/lib/report-presentation";
import { getPublicReportByToken } from "@/lib/public-report-service";
import { scoreReport } from "@/lib/report-score";
import { buildReportRecommendations } from "@/lib/report-recommendations";
import { correlateReportSignals } from "@/lib/report-correlations";

export const metadata: Metadata = {
  title: "Rapport de surveillance",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type PublicReportPageProps = {
  params: Promise<{ token: string }>;
};

const severityLabels = {
  info: "Info",
  low: "Faible",
  medium: "Moyenne",
  high: "Haute",
  critical: "Critique",
} as const;

const severityStyles = {
  info: "border-[#33405a] bg-[#111827] text-[#aeb9cc]",
  low: "border-[#39455c] bg-[#121722] text-[#c0c8d7]",
  medium: "border-[#7b5b32] bg-[#21180f] text-[#ffc47f]",
  high: "border-[#7a3f49] bg-[#251217] text-[#ff8e9d]",
  critical: "border-[#a44355] bg-[#301017] text-[#ff7185]",
} as const;

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(value);
}

export default async function PublicReportPage({
  params,
}: PublicReportPageProps) {
  const { token } = await params;
  const report = await getPublicReportByToken(token);
  if (!report) {
    notFound();
  }

  const counts = report.comparison?.counts;
  const rank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  const findings = [...report.scan.findings].sort(
    (a, b) => rank[b.severity] - rank[a.severity],
  );
  const findingGroups = groupFindingsForDisplay(findings);
  const scorecard = scoreReport({
    summary: report.scan.summary,
    findings,
  });
  const hasIncompleteAnalysis = scorecard.coverage !== "complete";
  const recommendations = buildReportRecommendations(findings, scorecard, 5);
  const correlations = correlateReportSignals({
    summary: report.scan.summary,
    findings,
  });

  return (
    <main className="min-h-screen">
      <header className="border-b border-[#242d40] bg-[#090c13]/90">
        <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] items-center justify-between py-5">
          <ProductMark />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
            Rapport partagé · lecture seule
          </span>
        </div>
      </header>

      <div className="report-print-scope mx-auto w-[min(1120px,calc(100%-32px))] py-10 lg:py-14">
        <section className="grid gap-8 border-b border-[#242d40] pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p
              className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: report.branding.accentColor }}
            >
              {report.branding.name}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              Rapport — {report.site.name}
            </h1>
            <p className="mt-3 break-all text-[#7f8a9f]">
              {report.site.canonicalUrl}
            </p>
          </div>
          <div className="lg:text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#627087]">
              Scan terminé
            </p>
            <p className="mt-2 text-sm text-[#c3cbd9]">
              {formatDate(report.scan.completedAt)}
            </p>
          </div>
        </section>

        {report.scan.scanMode === "public_audit" ? (
          <section className="border-b border-[#242d40] py-8">
            <div className="report-public-scope border-l-2 border-[#6d7cff] bg-[#0f1421] p-5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8793ff]">
                Portée de l’audit
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                Audit public passif et borné
              </h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-[#8f9aaf]">
                Ce rapport repose uniquement sur des observations publiques et
                des contrôles bornés. Il ne s’agit pas d’un pentest actif, d’une
                certification de sécurité ou d’une preuve d’absence de
                vulnérabilité.
              </p>
            </div>
          </section>
        ) : null}

        <ReportScorecard
          scorecard={scorecard}
          distinctProblems={findingGroups.length}
          occurrences={findings.length}
          pageCount={report.scan.pageCount}
        />

        <ReportRecommendationCounts counts={recommendations.counts} />

        {recommendations.priorities.length > 0 ? (
          <section className="border-t border-[#242d40] py-9">
            <p className="am-kicker">Priorités</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
              À traiter en premier
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7f8a9f]">
              Sélection des points les plus graves observés pendant ce scan,
              avec une lecture orientée impact et intervention.
            </p>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {recommendations.priorities.map((group, index) => {
                const finding = group.primary;
                const businessContext = getFindingBusinessContext(finding);
                return (
                  <article
                    key={group.key}
                    className="report-priority-card border border-[#242d40] bg-[#0d111a] p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-mono text-xs text-[#56627a]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        data-severity={finding.severity}
                        className={
                          "h-fit rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] " +
                          severityStyles[finding.severity]
                        }
                      >
                        {severityLabels[finding.severity]}
                      </span>
                    </div>
                    <h3 className="mt-4 font-semibold">
                      {getFindingDisplayTitle(finding)}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-[#8f9aaf]">
                      {businessContext.impact}
                    </p>
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs">
                      <div>
                        <dt className="text-[#647188]">Intervention</dt>
                        <dd className="mt-1 text-[#b8c1d0]">
                          {businessContext.intervention}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[#647188]">Effort estimé</dt>
                        <dd className="mt-1 text-[#b8c1d0]">
                          {businessContext.effort}
                        </dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <ReportSecurityHttp summary={report.scan.summary} />

        <ReportCorrelations correlations={correlations} />

        {counts ? (
          <section className="border-t border-[#242d40] py-9">
            <p className="am-kicker">Évolution</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
              Depuis le scan précédent
            </h2>
            <div className="mt-6 grid overflow-hidden border border-[#242d40] sm:grid-cols-5">
              {[
                ["Nouveaux", counts.new],
                ["Aggravés", counts.worsened],
                ["Améliorés", counts.improved],
                ["Résolus", counts.resolved],
                ["Inchangés", counts.unchanged],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="border-b border-[#242d40] p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#647188]">
                    {label}
                  </p>
                  <p className="mt-2 text-xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {report.screenshotAvailable ? (
          <section className="border-t border-[#242d40] py-9">
            <p className="am-kicker">Preuve visuelle</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
              Page principale au moment du scan
            </h2>
            <div className="mt-6 overflow-hidden rounded-lg border border-[#242d40] bg-[#080b12]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={"/r/" + encodeURIComponent(token) + "/screenshot"}
                alt={"Capture de " + report.site.name}
                className="h-auto w-full"
              />
            </div>
          </section>
        ) : null}

        {findingGroups.length > 0 ? (
          <ReportActionPlan groups={recommendations.groups} />
        ) : null}

        <ReportCoverageDetails summary={report.scan.summary} />

        <ReportTechnicalDetails summary={report.scan.summary} />

        <section className="border-t border-[#242d40] py-9">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="am-kicker">Analyse</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                Problèmes distincts
              </h2>
              <p className="mt-2 text-sm text-[#6f7b91]">
                {findingGroups.length} problème
                {findingGroups.length > 1 ? "s" : ""} distinct
                {findingGroups.length > 1 ? "s" : ""} · {findings.length}{" "}
                occurrence
                {findings.length > 1 ? "s" : ""}
              </p>
            </div>
            <span className="font-mono text-xs text-[#657188]">
              {String(findingGroups.length).padStart(2, "0")}
            </span>
          </div>

          {findings.length === 0 ? (
            <div className="mt-6 border-l-2 border-[#51d3a5] bg-[#0d1715] p-6 text-[#a9cabb]">
              {hasIncompleteAnalysis
                ? "Aucun problème détecté dans les données collectées. Certaines analyses sont partielles ou indisponibles : l’absence de finding ne vaut pas confirmation sur ces zones."
                : "Aucun finding enregistré pour ce scan."}
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {findingGroups.map((group, index) => {
                const finding = group.primary;
                const grouped = group.occurrenceCount > 1;
                const remediation = getFindingRemediation(finding.code);
                const businessContext = getFindingBusinessContext(finding);
                return (
                  <article
                    key={group.key}
                    className="report-finding-card border border-[#242d40] bg-[#0d111a] p-5 sm:p-6"
                  >
                    <div className="grid gap-4 sm:grid-cols-[42px_1fr_auto]">
                      <span className="font-mono text-xs text-[#56627a]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#647188]">
                          {finding.category}
                        </p>
                        <h3 className="mt-2 font-semibold">
                          {getFindingDisplayTitle(finding)}
                        </h3>
                        {grouped ? (
                          <ReportAffectedPages
                            occurrenceCount={group.occurrenceCount}
                            pageUrls={group.pageUrls}
                          />
                        ) : finding.pageUrl ? (
                          <p className="mt-2 break-all text-sm text-[#6f7b91]">
                            {finding.pageUrl}
                          </p>
                        ) : null}
                      </div>
                      <span
                        data-severity={finding.severity}
                        className={
                          "h-fit rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] " +
                          severityStyles[finding.severity]
                        }
                      >
                        {severityLabels[finding.severity]}
                      </span>
                    </div>

                    <dl className="mt-5 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                      <div className="bg-black/15 px-4 py-3">
                        <dt className="text-xs text-[#647188]">
                          Impact concret
                        </dt>
                        <dd className="mt-1 text-sm leading-6 text-[#aeb7c8]">
                          {businessContext.impact}
                        </dd>
                      </div>
                      <div className="bg-black/15 px-4 py-3">
                        <dt className="text-xs text-[#647188]">Intervention</dt>
                        <dd className="mt-1 text-sm text-[#aeb7c8]">
                          {businessContext.intervention}
                        </dd>
                      </div>
                      <div className="bg-black/15 px-4 py-3">
                        <dt className="text-xs text-[#647188]">
                          Effort estimé
                        </dt>
                        <dd className="mt-1 text-sm text-[#aeb7c8]">
                          {businessContext.effort}
                        </dd>
                      </div>
                    </dl>

                    {remediation ? (
                      <div className="report-remediation mt-5 border-l-2 border-[#6d7cff] bg-[#0f1421] p-5">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8793ff]">
                          Comment corriger
                        </p>
                        <h4 className="mt-2 font-semibold text-[#eef1ff]">
                          {remediation.title}
                        </h4>
                        <p className="mt-4 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[#647188]">
                          Ce que cela signifie
                        </p>
                        <p className="mt-1 text-sm leading-6 text-[#8f9aaf]">
                          {remediation.summary}
                        </p>
                        <p className="mt-4 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[#647188]">
                          Plan de correction
                        </p>
                        <ol className="mt-4 space-y-2 text-sm leading-6 text-[#aeb7c8]">
                          {remediation.steps.map((step, stepIndex) => (
                            <li key={step} className="flex gap-3">
                              <span className="font-mono text-[#7f8cff]">
                                {stepIndex + 1}.
                              </span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                        <p className="mt-4 border-t border-white/10 pt-4 text-xs leading-5 text-[#7f8a9f]">
                          <span className="font-semibold text-[#aeb7c8]">
                            Vérification :
                          </span>{" "}
                          {remediation.verification}
                        </p>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className="border-t border-[#242d40] py-6 font-mono text-[10px] uppercase tracking-[0.1em] text-[#556176]">
          Rapport généré par Agency Monitor · lien valable jusqu’au{" "}
          {formatDate(report.expiresAt)} · lecture seule
        </footer>
      </div>
    </main>
  );
}
