import {
  OrganizationReadSchema,
  ScanResultSchema,
  SiteReadSchema,
} from "@agency-saas/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/product-shell";
import { requireCurrentSession } from "@/lib/current-session";
import { getFindingRemediation } from "@/lib/finding-remediation";
import { groupFindingsForDisplay } from "@/lib/finding-display";
import {
  getFindingBusinessContext,
  getFindingDisplayTitle,
  summarizeReportFindings,
} from "@/lib/report-presentation";
import { getScanDetailsForSite } from "@/lib/scan-history";
import {
  reportScoreCategoryForFindingCategory,
  scoreReport,
  type ReportScoreCategoryKey,
} from "@/lib/report-score";
import { reportActionAnchorId } from "@/lib/report-navigation";
import { buildReportRecommendations } from "@/lib/report-recommendations";
import { correlateReportSignals } from "@/lib/report-correlations";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { listActiveReportShares } from "@/lib/report-share-service";
import { ScanStatusRefresher } from "@/components/scan-status-refresher";
import { PrintReportButton } from "@/components/print-report-button";
import { ReportAffectedPages } from "@/components/report-affected-pages";
import { ReportActionPlan } from "@/components/report-action-plan";
import { ReportCorrelations } from "@/components/report-correlations";
import { ReportCoverageDetails } from "@/components/report-coverage-details";
import { ReportRecommendationCounts } from "@/components/report-recommendation-counts";
import { ReportSecurityHttp } from "@/components/report-security-http";
import { ReportTechnicalDetails } from "@/components/report-technical-details";
import { ReportScorecard } from "@/components/report-scorecard";
import { ReportSharePanel } from "./report-share-panel";

type ScanPageProps = {
  params: Promise<{
    organizationId: string;
    siteId: string;
    scanId: string;
  }>;
};

const scanStatusLabels = {
  queued: "En file",
  running: "En cours",
  completed: "Terminé",
  failed: "Échec",
  cancelled: "Annulé",
} as const;

const severityLabels = {
  info: "Info",
  low: "Faible",
  medium: "Moyenne",
  high: "Haute",
  critical: "Critique",
} as const;

const findingCategoryLabels: Record<string, string> = {
  availability: "Disponibilité",
  "broken-link": "Lien cassé",
  javascript: "JavaScript",
  tls: "TLS",
  "security-header": "En-tête de sécurité",
  accessibility: "Accessibilité",
  performance: "Performance",
  seo: "SEO",
  network: "Réseau",
};

const severityRank = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
} as const;

const severityStyles = {
  info: "border-[#33405a] bg-[#111827] text-[#aeb9cc]",
  low: "border-[#39455c] bg-[#121722] text-[#c0c8d7]",
  medium: "border-[#7b5b32] bg-[#21180f] text-[#ffc47f]",
  high: "border-[#7a3f49] bg-[#251217] text-[#ff8e9d]",
  critical: "border-[#a44355] bg-[#301017] text-[#ff7185]",
} as const;

const findingChangeLabels = {
  new: "Nouveau",
  worsened: "Aggravé",
  improved: "Amélioré",
  unchanged: "Inchangé",
} as const;

function formatDate(value: Date | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris",
  }).format(value);
}

function visibleEvidence(
  evidence: Record<string, unknown>,
): Array<[string, string]> {
  const labels: Record<string, string> = {
    statusCode: "Statut HTTP",
    durationMs: "Durée HTTP (ms)",
    header: "En-tête",
    errorCode: "Code erreur",
    remainingDays: "Jours restants",
    validTo: "Expiration TLS",
    protocol: "Protocole TLS",
    value: "Valeur observée",
    kind: "Type",
    sourcePageUrl: "Page source",
    errorCount: "Erreurs JavaScript",
    ruleId: "Règle accessibilité",
    impact: "Impact",
    nodeCount: "Éléments concernés",
    observedValue: "Valeur observée",
    warningThreshold: "Seuil d’alerte",
    highThreshold: "Seuil haut",
    unit: "Unité",
    party: "Origine réseau",
    resourceType: "Type de ressource",
    failureClass: "Classe d’échec",
    occurrenceCount: "Occurrences",
    affectedPageCount: "Pages affectées",
  };

  return Object.entries(labels).flatMap(([key, label]) => {
    const value = evidence[key];
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      return [];
    }

    return [[label, String(value)]];
  });
}

async function loadScan(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
) {
  try {
    return await getScanDetailsForSite(userId, organizationId, siteId, scanId);
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      notFound();
    }
    throw error;
  }
}

export default async function ScanPage({ params }: ScanPageProps) {
  const { organizationId, siteId, scanId } = await params;

  if (
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success ||
    !SiteReadSchema.shape.id.safeParse(siteId).success ||
    !ScanResultSchema.shape.scanId.safeParse(scanId).success
  ) {
    notFound();
  }

  const session = await requireCurrentSession();
  const details = await loadScan(
    session.user.id,
    organizationId,
    siteId,
    scanId,
  );

  if (!details) {
    notFound();
  }

  const pending =
    details.scan.status === "queued" || details.scan.status === "running";
  const orderedFindings = [...details.findings].sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity],
  );
  const findingGroups = groupFindingsForDisplay(orderedFindings);
  const distinctFindings = findingGroups.map((group) => group.primary);
  const reportSummary = summarizeReportFindings(distinctFindings);
  const comparison = details.comparison;
  const scorecard = scoreReport({
    summary: details.scan.summary,
    findings: orderedFindings,
  });
  const recommendations = buildReportRecommendations(
    orderedFindings,
    scorecard,
    5,
  );
  const categoryActionTargets: Partial<Record<ReportScoreCategoryKey, string>> =
    {};
  for (const group of recommendations.groups) {
    const categoryKey = reportScoreCategoryForFindingCategory(
      group.primary.category,
    );
    if (categoryKey && !categoryActionTargets[categoryKey]) {
      categoryActionTargets[categoryKey] = reportActionAnchorId(group.key);
    }
  }
  const correlations = correlateReportSignals({
    summary: details.scan.summary,
    findings: orderedFindings,
  });
  const isUnverifiedPublicAudit =
    details.scan.scanMode === "public_audit" &&
    (details.site.status !== "active" || !details.site.verifiedAt);
  const canShareReport = !isUnverifiedPublicAudit;
  const activeShares =
    details.scan.status === "completed" &&
    details.access.role !== "member" &&
    canShareReport
      ? await listActiveReportShares(
          session.user.id,
          organizationId,
          siteId,
          scanId,
        )
      : [];

  return (
    <WorkspaceShell
      trail={[
        {
          label: details.site.name,
          href: "/organizations/" + organizationId + "/sites/" + siteId,
        },
        {
          label:
            details.scan.scanMode === "public_audit"
              ? "Audit public"
              : "Monitoring vérifié",
        },
      ]}
    >
      <ScanStatusRefresher active={pending} />

      <div className="print-only am-print-brand" aria-hidden="true">
        <div>
          <strong>WebProbe</strong>
          <span>Rapport d’audit technique</span>
        </div>
        <div className="am-print-brand-meta">
          <span>
            {details.scan.scanMode === "public_audit"
              ? "Audit public"
              : "Monitoring vérifié"}
          </span>
          <span>{formatDate(details.scan.completedAt)}</span>
        </div>
      </div>

      <section className="border-b border-[#242d40] pb-9">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="am-kicker">
              {details.scan.scanMode === "public_audit"
                ? "Audit public"
                : "Monitoring vérifié"}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em]">
              {details.site.name}
            </h1>
            <p className="mt-3 break-all text-white/45">
              {details.site.canonicalUrl}
            </p>
            {isUnverifiedPublicAudit && details.access.role !== "member" ? (
              <Link
                href={`/organizations/${organizationId}/sites/${siteId}/verify`}
                className="am-button-secondary no-print mt-5 inline-flex"
              >
                Activer le monitoring
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {details.scan.status === "completed" ? <PrintReportButton /> : null}
            <span className="inline-flex items-center gap-2 rounded-md border border-[#33405a] bg-[#101622] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#aeb8ca]">
              {pending ? (
                <span className="size-1.5 animate-pulse rounded-sm bg-[#39c7ff]" />
              ) : null}
              {scanStatusLabels[details.scan.status]}
            </span>
          </div>
        </div>

        <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="am-panel-soft p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Mode
            </dt>
            <dd className="mt-2 text-sm">
              {details.scan.scanMode === "public_audit"
                ? "Audit public"
                : "Monitoring vérifié"}
            </dd>
          </div>
          <div className="am-panel-soft p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Déclenchement
            </dt>
            <dd className="mt-2 text-sm">
              {details.scan.trigger === "manual" ? "Manuel" : "Planifié"}
            </dd>
          </div>
          <div className="am-panel-soft p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Mis en file
            </dt>
            <dd className="mt-2 text-sm">
              {formatDate(details.scan.queuedAt)}
            </dd>
          </div>
          <div className="am-panel-soft p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Terminé
            </dt>
            <dd className="mt-2 text-sm">
              {formatDate(details.scan.completedAt)}
            </dd>
          </div>
          <div className="am-panel-soft p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Pages observées
            </dt>
            <dd className="mt-2 text-sm">{details.scan.pageCount}</dd>
          </div>
        </dl>

        {pending ? (
          <div
            aria-live="polite"
            aria-busy="true"
            className="mt-6 border-l-2 border-[#39c7ff] bg-[#0b141d] p-5"
          >
            <div className="flex items-center gap-3">
              <span className="size-2.5 animate-pulse rounded-sm bg-[#39c7ff]" />
              <p className="font-semibold text-[#dff7ff]">
                {details.scan.status === "queued"
                  ? "Scan en attente de démarrage"
                  : "Scan en cours d’analyse"}
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/50">
              {details.scan.status === "queued"
                ? "Étape 1 sur 3 · le scan attend un worker disponible. Aucun trafic vers la cible n’est encore nécessaire."
                : "Étape 2 sur 3 · navigation bornée, collecte et analyses sont en cours. Le rapport sera généré à la fin de cette étape."}
            </p>
            <ol className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                {
                  label: "Préparation",
                  state: details.scan.status === "queued" ? "active" : "done",
                },
                {
                  label: "Analyse bornée",
                  state:
                    details.scan.status === "running" ? "active" : "upcoming",
                },
                { label: "Génération du rapport", state: "upcoming" },
              ].map((step) => (
                <li
                  key={step.label}
                  className={
                    "rounded-md border px-3 py-2 text-xs " +
                    (step.state === "done"
                      ? "border-emerald-400/25 bg-emerald-400/[0.05] text-emerald-100"
                      : step.state === "active"
                        ? "border-sky-300/30 bg-sky-300/[0.06] text-sky-100"
                        : "border-white/10 bg-black/10 text-white/35")
                  }
                >
                  {step.state === "done"
                    ? "✓ "
                    : step.state === "active"
                      ? "• "
                      : ""}
                  {step.label}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>

      {details.scan.scanMode === "public_audit" ? (
        <section className="border-b border-[#242d40] py-8">
          <div className="report-public-scope border-l-2 border-[#6d7cff] bg-[#0f1421] p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8793ff]">
              Portée de l’audit
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              Audit public passif et borné
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-white/50">
              WebProbe observe uniquement des ressources accessibles
              publiquement, respecte les limites de crawl et robots.txt et
              n’effectue pas de pentest actif. Ce rapport décrit les signaux
              effectivement observés ; il ne constitue pas une certification de
              sécurité ni la preuve de l’absence de vulnérabilité.
            </p>
          </div>
        </section>
      ) : null}

      {details.scan.status === "completed" ? (
        <ReportScorecard
          scorecard={scorecard}
          distinctProblems={reportSummary.total}
          occurrences={orderedFindings.length}
          pageCount={details.scan.pageCount}
          categoryTargets={categoryActionTargets}
        />
      ) : null}

      {details.scan.status === "completed" ? (
        <ReportRecommendationCounts counts={recommendations.counts} />
      ) : null}

      {details.scan.status === "completed" &&
      recommendations.priorities.length > 0 ? (
        <section className="border-b border-[#242d40] py-10">
          <p className="am-kicker">Priorités</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
            À traiter en premier
          </h2>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {recommendations.priorities.map((group, index) => {
              const finding = group.primary;
              const businessContext = getFindingBusinessContext(finding);
              return (
                <a
                  key={group.key}
                  href={"#" + reportActionAnchorId(group.key)}
                  aria-label={
                    "Priorité " +
                    String(index + 1).padStart(2, "0") +
                    " : voir la remédiation"
                  }
                  className="report-priority-card rounded-lg border border-[#242d40] bg-[#0d111a] p-5 transition hover:-translate-y-0.5 hover:border-[#46557a] hover:bg-[#111827] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#8793ff]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-mono text-xs text-[#56627a]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      data-severity={finding.severity}
                      className={
                        "rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] " +
                        severityStyles[finding.severity]
                      }
                    >
                      {severityLabels[finding.severity]}
                    </span>
                  </div>
                  <h3 className="mt-4 font-semibold">
                    {getFindingDisplayTitle(finding)}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/50">
                    {businessContext.impact}
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs">
                    <div>
                      <dt className="text-white/30">Intervention</dt>
                      <dd className="mt-1 text-white/65">
                        {businessContext.intervention}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-white/30">Effort estimé</dt>
                      <dd className="mt-1 text-white/65">
                        {businessContext.effort}
                      </dd>
                    </div>
                  </dl>
                  <span className="mt-4 inline-flex text-xs font-semibold text-[#8793ff]">
                    Voir la remédiation ↓
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      ) : null}

      {details.scan.status === "completed" ? (
        <ReportSecurityHttp summary={details.scan.summary} />
      ) : null}

      {details.scan.status === "completed" ? (
        <ReportCorrelations correlations={correlations} />
      ) : null}

      {details.scan.status === "failed" ||
      details.scan.status === "cancelled" ? (
        <section className="border-b border-[#242d40] py-10">
          <div className="border-l-2 border-amber-300/70 bg-amber-200/[0.05] p-5">
            <p className="font-semibold text-amber-100">
              {details.scan.status === "failed"
                ? "Le scan n’a pas pu produire un rapport complet."
                : "Le scan a été annulé avant la fin."}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-100/70">
              Les données éventuellement collectées restent visibles ci-dessous,
              mais elles ne doivent pas être interprétées comme une couverture
              complète. Relancez le scan lorsque la cause de l’interruption est
              résolue.
            </p>
          </div>
        </section>
      ) : null}

      {details.scan.status === "completed" &&
      details.access.role !== "member" &&
      canShareReport ? (
        <div className="no-print">
          <ReportSharePanel
            organizationId={organizationId}
            siteId={siteId}
            scanId={scanId}
            shares={activeShares.map((share) => ({
              ...share,
              expiresAt: share.expiresAt.toISOString(),
              createdAt: share.createdAt.toISOString(),
            }))}
          />
        </div>
      ) : details.scan.status === "completed" &&
        details.access.role !== "member" &&
        isUnverifiedPublicAudit ? (
        <section className="no-print border-b border-[#242d40] py-10">
          <p className="text-sm text-white/45">Confidentialité</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Rapport privé tant que le site n’est pas vérifié
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
            Cet audit reste visible uniquement dans votre organisation. La
            création d’un lien public ou l’envoi par e-mail sera disponible
            après activation du monitoring par vérification DNS.
          </p>
        </section>
      ) : null}

      {details.screenshotAvailable ? (
        <section className="no-print border-b border-white/10 py-10">
          <p className="text-sm text-white/45">Capture visuelle</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Aperçu de la page principale
          </h2>
          <p className="mt-2 text-sm text-white/40">
            Capture bornée au viewport du navigateur au moment du scan.
          </p>
          <div className="mt-6 overflow-hidden rounded-lg border border-[#242d40] bg-[#080b12]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/organizations/${organizationId}/sites/${siteId}/scans/${scanId}/screenshot`}
              alt={`Capture de ${details.site.name}`}
              className="h-auto w-full"
            />
          </div>
        </section>
      ) : null}

      {comparison ? (
        <section className="border-b border-white/10 py-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm text-white/45">Évolution</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                Depuis le scan précédent
              </h2>
              <p className="mt-2 text-sm text-white/40">
                Baseline terminée le{" "}
                {formatDate(comparison.previousCompletedAt)}
              </p>
            </div>
            <Link
              href={`/organizations/${organizationId}/sites/${siteId}/scans/${comparison.previousScanId}`}
              className="text-sm font-semibold text-[#7d8aff] transition hover:text-[#aab2ff]"
            >
              Voir le scan précédent →
            </Link>
          </div>

          <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Nouveaux", comparison.counts.new],
              ["Aggravés", comparison.counts.worsened],
              ["Améliorés", comparison.counts.improved],
              ["Résolus", comparison.counts.resolved],
              ["Inchangés", comparison.counts.unchanged],
            ].map(([label, value]) => (
              <div key={label} className="am-panel-soft p-4">
                <dt className="text-xs uppercase tracking-[0.14em] text-white/35">
                  {label}
                </dt>
                <dd className="mt-2 text-2xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {details.scan.status === "completed" && findingGroups.length > 0 ? (
        <ReportActionPlan groups={recommendations.groups} />
      ) : null}

      {details.scan.status === "completed" &&
      isUnverifiedPublicAudit &&
      details.access.role !== "member" ? (
        <section className="no-print border-b border-[#242d40] py-10">
          <div className="rounded-lg border border-[#2d3751] bg-[#0d121d] p-6">
            <p className="am-kicker">Monitoring continu</p>
            <h2 className="mt-3 text-xl font-semibold">
              Passer du diagnostic au suivi continu
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7f8a9f]">
              Vérifiez la propriété du domaine pour débloquer les scans
              automatiques, l’historique complet, les comparaisons dans le
              temps, les alertes et le suivi des incidents.
            </p>
            <ul className="mt-4 grid gap-2 text-sm text-[#9aa6b9] sm:grid-cols-2 lg:grid-cols-3">
              <li>✓ Scans automatiques</li>
              <li>✓ Historique complet</li>
              <li>✓ Comparaison dans le temps</li>
              <li>✓ Alertes</li>
              <li>✓ Suivi des incidents</li>
            </ul>
            <Link
              href={`/organizations/${organizationId}/sites/${siteId}/verify`}
              className="am-button-secondary mt-5 inline-flex"
            >
              Vérifier le domaine
            </Link>
          </div>
        </section>
      ) : null}

      {details.scan.status === "completed" ? (
        <ReportCoverageDetails summary={details.scan.summary} />
      ) : null}

      {details.scan.status === "completed" ? (
        <ReportTechnicalDetails summary={details.scan.summary} />
      ) : null}

      <section className="py-10">
        <p className="text-sm text-white/45">Analyse</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          {findingGroups.length} problème
          {findingGroups.length > 1 ? "s" : ""} distinct
          {findingGroups.length > 1 ? "s" : ""} · {orderedFindings.length}{" "}
          occurrence{orderedFindings.length > 1 ? "s" : ""}
        </h2>

        {orderedFindings.length === 0 ? (
          <div className="mt-6 border-l-2 border-[#46557a] bg-[#0d121d] p-8">
            <p className="text-white/50">
              Aucun finding enregistré pour ce scan.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {findingGroups.map((group) => {
              const finding = group.primary;
              const grouped = group.occurrenceCount > 1;
              const evidence = grouped ? [] : visibleEvidence(finding.evidence);
              const remediation = getFindingRemediation(finding.code);
              const businessContext = getFindingBusinessContext(finding);
              const change = grouped
                ? null
                : comparison?.changesByFingerprint[finding.fingerprint];
              return (
                <article
                  key={group.key}
                  className="report-finding-card rounded-lg border border-[#242d40] bg-[#0d111a] p-6"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-white/35">
                        {findingCategoryLabels[finding.category] ??
                          finding.category}{" "}
                        · {finding.code}
                      </p>
                      <h3 className="mt-2 text-lg font-semibold">
                        {getFindingDisplayTitle(finding)}
                      </h3>
                      {grouped ? (
                        <ReportAffectedPages
                          occurrenceCount={group.occurrenceCount}
                          pageUrls={group.pageUrls}
                        />
                      ) : finding.pageUrl ? (
                        <p className="mt-2 break-all text-sm text-white/40">
                          {finding.pageUrl}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {change ? (
                        <span className="rounded-md border border-[#49558b] bg-[#151a31] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#aab2ff]">
                          {findingChangeLabels[change.change]}
                          {change.previousSeverity &&
                          change.previousSeverity !== finding.severity
                            ? ` · ${severityLabels[change.previousSeverity]} → ${severityLabels[finding.severity]}`
                            : ""}
                        </span>
                      ) : null}
                      <span
                        data-severity={finding.severity}
                        className={
                          "rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] " +
                          severityStyles[finding.severity]
                        }
                      >
                        {severityLabels[finding.severity]}
                      </span>
                    </div>
                  </div>

                  <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
                    <div className="rounded-lg bg-black/15 px-4 py-3">
                      <dt className="text-xs text-white/35">Impact concret</dt>
                      <dd className="mt-1 text-sm leading-6 text-white/65">
                        {businessContext.impact}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-black/15 px-4 py-3">
                      <dt className="text-xs text-white/35">
                        Type d’intervention
                      </dt>
                      <dd className="mt-1 text-sm text-white/70">
                        {businessContext.intervention}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-black/15 px-4 py-3">
                      <dt className="text-xs text-white/35">Effort estimé</dt>
                      <dd className="mt-1 text-sm text-white/70">
                        {businessContext.effort}
                      </dd>
                    </div>
                  </dl>

                  {evidence.length > 0 ? (
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {evidence.map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-lg bg-black/15 px-4 py-3"
                        >
                          <dt className="text-xs text-white/35">{label}</dt>
                          <dd className="mt-1 break-all text-sm text-white/70">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {remediation ? (
                    <div className="report-remediation mt-5 border-l-2 border-[#6d7cff] bg-[#0f1421] p-5">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8793ff]">
                        Comment corriger
                      </p>
                      <h4 className="mt-2 font-semibold text-[#eef1ff]">
                        {remediation.title}
                      </h4>
                      <p className="mt-4 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-white/35">
                        Ce que cela signifie
                      </p>
                      <p className="mt-1 text-sm leading-6 text-white/55">
                        {remediation.summary}
                      </p>
                      <p className="mt-4 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-white/35">
                        Plan de correction
                      </p>
                      <ol className="mt-4 space-y-2 text-sm leading-6 text-white/65">
                        {remediation.steps.map((step, index) => (
                          <li key={step} className="flex gap-3">
                            <span className="font-mono text-[#7f8cff]">
                              {index + 1}.
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                      <p className="mt-4 border-t border-white/10 pt-4 text-xs leading-5 text-white/45">
                        <span className="font-semibold text-white/65">
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

        {comparison && comparison.resolvedFindings.length > 0 ? (
          <div className="mt-10">
            <p className="text-sm text-white/45">Rétablissements</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">
              {comparison.resolvedFindings.length} finding
              {comparison.resolvedFindings.length > 1 ? "s" : ""} résolu
              {comparison.resolvedFindings.length > 1 ? "s" : ""}
            </h2>
            <div className="mt-4 space-y-3">
              {comparison.resolvedFindings.map((finding) => (
                <article
                  key={finding.fingerprint}
                  className="rounded-lg border border-[#285747] bg-[#0d1715] p-5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#72c6a5]">
                        Résolu · {finding.code}
                      </p>
                      <h3 className="mt-2 font-medium">{finding.title}</h3>
                      {finding.pageUrl ? (
                        <p className="mt-2 break-all text-sm text-white/40">
                          {finding.pageUrl}
                        </p>
                      ) : null}
                    </div>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/55">
                      Ancienne sévérité : {severityLabels[finding.severity]}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </WorkspaceShell>
  );
}
