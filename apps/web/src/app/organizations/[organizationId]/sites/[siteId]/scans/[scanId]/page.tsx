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
import { getScanDetailsForSite } from "@/lib/scan-history";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { listActiveReportShares } from "@/lib/report-share-service";
import { ScanStatusRefresher } from "@/components/scan-status-refresher";
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

type ScannerV2AnalyzerStatus = "complete" | "partial" | "unavailable";

const scannerV2AnalyzerLabels = {
  crawl: "Crawl",
  network: "Réseau",
  performance: "Performance",
  seo: "SEO",
  accessibility: "Accessibilité",
} as const;

const scannerV2StatusLabels: Record<ScannerV2AnalyzerStatus, string> = {
  complete: "Complet",
  partial: "Partiel",
  unavailable: "Indisponible",
};

function scannerV2Quality(
  summary: Record<string, unknown>,
): Record<
  keyof typeof scannerV2AnalyzerLabels,
  ScannerV2AnalyzerStatus
> | null {
  const scannerV2 = summary.scannerV2;
  if (typeof scannerV2 !== "object" || scannerV2 === null) {
    return null;
  }

  const completeness = (scannerV2 as { completeness?: unknown }).completeness;
  if (typeof completeness !== "object" || completeness === null) {
    return null;
  }

  const result = {} as Record<
    keyof typeof scannerV2AnalyzerLabels,
    ScannerV2AnalyzerStatus
  >;
  for (const analyzer of Object.keys(scannerV2AnalyzerLabels) as Array<
    keyof typeof scannerV2AnalyzerLabels
  >) {
    const value = (completeness as Record<string, unknown>)[analyzer];
    const status =
      typeof value === "object" && value !== null
        ? (value as { status?: unknown }).status
        : null;
    if (
      status !== "complete" &&
      status !== "partial" &&
      status !== "unavailable"
    ) {
      if (analyzer === "accessibility") {
        result[analyzer] = "unavailable";
        continue;
      }
      return null;
    }
    result[analyzer] = status;
  }

  return result;
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
  const comparison = details.comparison;
  const scannerV2QualityState = scannerV2Quality(details.scan.summary);
  const scanAnalysisIncomplete =
    !scannerV2QualityState ||
    Object.values(scannerV2QualityState).some(
      (status) => status !== "complete",
    );
  const activeShares =
    details.scan.status === "completed" && details.access.role !== "member"
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
        { label: "Rapport de scan" },
      ]}
    >
      <ScanStatusRefresher active={pending} />

      <section className="border-b border-[#242d40] pb-9">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="am-kicker">Résultat du scan</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em]">
              {details.site.name}
            </h1>
            <p className="mt-3 break-all text-white/45">
              {details.site.canonicalUrl}
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-md border border-[#33405a] bg-[#101622] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#aeb8ca]">
            {pending ? (
              <span className="size-1.5 animate-pulse rounded-sm bg-[#39c7ff]" />
            ) : null}
            {scanStatusLabels[details.scan.status]}
          </span>
        </div>

        <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              La page se met à jour automatiquement toutes les quelques
              secondes. Le rapport apparaîtra ici dès que l’analyse sera
              terminée.
            </p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-300/70" />
            </div>
          </div>
        ) : null}
      </section>

      {details.scan.status === "completed" &&
      details.access.role !== "member" ? (
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
      ) : null}

      {details.screenshotAvailable ? (
        <section className="border-b border-white/10 py-10">
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

      {scannerV2QualityState ? (
        <section className="border-b border-white/10 py-10">
          <p className="text-sm text-white/45">Qualité de l’analyse</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Couverture Scanner V2
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/40">
            Un analyseur partiel signifie que ses résultats restent
            exploitables, mais que certaines observations n’ont pas pu être
            collectées. Cela ne transforme pas le scan en échec.
          </p>
          <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {(
              Object.entries(scannerV2QualityState) as Array<
                [keyof typeof scannerV2AnalyzerLabels, ScannerV2AnalyzerStatus]
              >
            ).map(([analyzer, status]) => (
              <div key={analyzer} className="am-panel-soft p-4">
                <dt className="text-xs uppercase tracking-[0.14em] text-white/35">
                  {scannerV2AnalyzerLabels[analyzer]}
                </dt>
                <dd className="mt-2 text-sm font-semibold">
                  {scannerV2StatusLabels[status]}
                </dd>
              </div>
            ))}
          </dl>
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
          {comparison.limited ? (
            <p className="mt-4 text-sm text-[#ffc47f]">
              Comparaison limitée : certaines vérifications étaient
              indisponibles dans l’un des scans.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="py-10">
        <p className="text-sm text-white/45">Analyse</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          {findingGroups.length} problème
          {findingGroups.length > 1 ? "s" : ""}
        </h2>

        {orderedFindings.length === 0 ? (
          <div className="mt-6 border-l-2 border-[#46557a] bg-[#0d121d] p-8">
            <p className="text-white/50">
              {pending
                ? "Analyse en cours."
                : scanAnalysisIncomplete
                  ? "Aucun finding observé dans la partie analysée ; certaines vérifications sont incomplètes."
                  : "Aucun finding enregistré pour ce scan."}
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {findingGroups.map((group) => {
              const finding = group.primary;
              const grouped = group.findings.length > 1;
              const evidence = grouped ? [] : visibleEvidence(finding.evidence);
              const remediation = getFindingRemediation(finding.code);
              const change = grouped
                ? null
                : comparison?.changesByFingerprint[finding.fingerprint];
              return (
                <article
                  key={group.key}
                  className="rounded-lg border border-[#242d40] bg-[#0d111a] p-6"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-white/35">
                        {findingCategoryLabels[finding.category] ??
                          finding.category}{" "}
                        · {finding.code}
                      </p>
                      <h3 className="mt-2 text-lg font-semibold">
                        {finding.title}
                      </h3>
                      {grouped ? (
                        <div className="mt-3">
                          <span className="inline-flex rounded-md border border-[#40506d] bg-[#121a28] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#b8c6dc]">
                            {group.pageUrls.length} pages concernées
                          </span>
                          <ul className="mt-3 space-y-1.5 text-sm text-white/40">
                            {group.pageUrls.map((pageUrl) => (
                              <li key={pageUrl} className="break-all">
                                {pageUrl}
                              </li>
                            ))}
                          </ul>
                        </div>
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
                        className={
                          "rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] " +
                          severityStyles[finding.severity]
                        }
                      >
                        {severityLabels[finding.severity]}
                      </span>
                    </div>
                  </div>

                  {evidence.length > 0 ? (
                    <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                    <div className="mt-5 border-l-2 border-[#6d7cff] bg-[#0f1421] p-5">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8793ff]">
                        Comment corriger
                      </p>
                      <h4 className="mt-2 font-semibold text-[#eef1ff]">
                        {remediation.title}
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-white/55">
                        {remediation.summary}
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
