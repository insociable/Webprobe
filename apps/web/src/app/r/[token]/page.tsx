import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductMark } from "@/components/product-shell";
import { getFindingRemediation } from "@/lib/finding-remediation";
import { groupFindingsForDisplay } from "@/lib/finding-display";
import {
  getFindingBusinessContext,
  getPriorityFindings,
  summarizeReportFindings,
  summarizeReportSections,
} from "@/lib/report-presentation";
import { getPublicReportByToken } from "@/lib/public-report-service";
import {
  scannerV2CrawlLimitation,
  scannerV2Quality,
} from "@/lib/scanner-v2-quality";

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

const scannerV2AnalyzerLabels = {
  crawl: "Crawl",
  network: "Réseau",
  performance: "Performance",
  seo: "SEO",
} as const;

const scannerV2StatusLabels = {
  complete: "Complet",
  partial: "Partiel",
  unavailable: "Indisponible",
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
  const reportSummary = summarizeReportFindings(findings);
  const sectionSummaries = summarizeReportSections(findings);
  const priorityFindings = getPriorityFindings(findings, 3);
  const quality = scannerV2Quality(report.scan.summary);
  const crawlLimitation = scannerV2CrawlLimitation(report.scan.summary);
  const hasIncompleteAnalysis =
    quality !== null &&
    Object.values(quality).some((status) => status !== "complete");
  const analysisCoverage = quality
    ? Object.values(quality).every((status) => status === "complete")
      ? "Complète"
      : "Partielle"
    : "Non mesurée";

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

      <div className="mx-auto w-[min(1120px,calc(100%-32px))] py-10 lg:py-14">
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
            <div className="border-l-2 border-[#6d7cff] bg-[#0f1421] p-5">
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

        <section className="py-8">
          <div className="am-metric-grid">
            <div className="am-metric-cell">
              <p className="am-metric-label">Pages observées</p>
              <p className="am-metric-value">{report.scan.pageCount}</p>
            </div>
            <div className="am-metric-cell">
              <p className="am-metric-label">Problèmes</p>
              <p className="am-metric-value">{findingGroups.length}</p>
            </div>
            <div className="am-metric-cell">
              <p className="am-metric-label">Hauts / critiques</p>
              <p className="am-metric-value">{reportSummary.highOrCritical}</p>
            </div>
            <div className="am-metric-cell">
              <p className="am-metric-label">Couverture</p>
              <p className="mt-2 text-sm font-medium text-[#d5dbe7]">
                {analysisCoverage}
              </p>
            </div>
          </div>
        </section>

        {priorityFindings.length > 0 ? (
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
              {priorityFindings.map((finding, index) => {
                const businessContext = getFindingBusinessContext(finding);
                return (
                  <article
                    key={`${finding.fingerprint}:priority`}
                    className="border border-[#242d40] bg-[#0d111a] p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-mono text-xs text-[#56627a]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={
                          "h-fit rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] " +
                          severityStyles[finding.severity]
                        }
                      >
                        {severityLabels[finding.severity]}
                      </span>
                    </div>
                    <h3 className="mt-4 font-semibold">{finding.title}</h3>
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

        {sectionSummaries.length > 0 ? (
          <section className="border-t border-[#242d40] py-9">
            <p className="am-kicker">Analyse par domaine</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
              Où concentrer l’attention
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7f8a9f]">
              Les constats sont regroupés pour séparer les enjeux de sécurité,
              visibilité, performance et disponibilité.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sectionSummaries.map((section) => (
                <article
                  key={section.definition.key}
                  className="border border-[#242d40] bg-[#0d111a] p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">
                      {section.definition.label}
                    </h3>
                    {section.highestSeverity ? (
                      <span
                        className={
                          "rounded-md border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] " +
                          severityStyles[section.highestSeverity]
                        }
                      >
                        {severityLabels[section.highestSeverity]}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#7f8a9f]">
                    {section.definition.description}
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs">
                    <div>
                      <dt className="text-[#647188]">Constats</dt>
                      <dd className="mt-1 text-lg font-semibold">
                        {section.total}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#647188]">Hauts / critiques</dt>
                      <dd className="mt-1 text-lg font-semibold">
                        {section.highOrCritical}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {quality ? (
          <section className="border-t border-[#242d40] py-9">
            <p className="am-kicker">Qualité de l’analyse</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
              Couverture Scanner V2
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7f8a9f]">
              Un état partiel ou indisponible décrit la qualité de collecte. Il
              ne transforme pas le scan en échec.
            </p>
            {crawlLimitation ? (
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#d4b27b]">
                {crawlLimitation === "robots-restricted"
                  ? "Le fichier robots.txt limite volontairement la couverture du crawl."
                  : "La politique robots.txt n’a pas pu être déterminée de façon fiable ; le crawl profond a été arrêté par précaution."}
              </p>
            ) : null}
            <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(quality).map(([analyzer, status]) => (
                <div
                  key={analyzer}
                  className="border border-[#242d40] bg-[#0d111a] p-4"
                >
                  <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#647188]">
                    {
                      scannerV2AnalyzerLabels[
                        analyzer as keyof typeof scannerV2AnalyzerLabels
                      ]
                    }
                  </dt>
                  <dd className="mt-2 text-sm font-semibold text-[#d5dbe7]">
                    {scannerV2StatusLabels[status]}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

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

        <section className="border-t border-[#242d40] py-9">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="am-kicker">Analyse</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                Findings observés
              </h2>
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
                const grouped = group.findings.length > 1;
                const remediation = getFindingRemediation(finding.code);
                const businessContext = getFindingBusinessContext(finding);
                return (
                  <article
                    key={group.key}
                    className="border border-[#242d40] bg-[#0d111a] p-5 sm:p-6"
                  >
                    <div className="grid gap-4 sm:grid-cols-[42px_1fr_auto]">
                      <span className="font-mono text-xs text-[#56627a]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#647188]">
                          {finding.category}
                        </p>
                        <h3 className="mt-2 font-semibold">{finding.title}</h3>
                        {grouped ? (
                          <div className="mt-3">
                            <span className="inline-flex rounded-md border border-[#40506d] bg-[#121a28] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#b8c6dc]">
                              {group.pageUrls.length} pages concernées
                            </span>
                            <ul className="mt-3 space-y-1.5 text-sm text-[#6f7b91]">
                              {group.pageUrls.map((pageUrl) => (
                                <li key={pageUrl} className="break-all">
                                  {pageUrl}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : finding.pageUrl ? (
                          <p className="mt-2 break-all text-sm text-[#6f7b91]">
                            {finding.pageUrl}
                          </p>
                        ) : null}
                      </div>
                      <span
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
                      <div className="mt-5 border-l-2 border-[#6d7cff] bg-[#0f1421] p-5">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8793ff]">
                          Comment corriger
                        </p>
                        <h4 className="mt-2 font-semibold text-[#eef1ff]">
                          {remediation.title}
                        </h4>
                        <p className="mt-2 text-sm leading-6 text-[#8f9aaf]">
                          {remediation.summary}
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
