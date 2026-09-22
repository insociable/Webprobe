import {
  OrganizationReadSchema,
  ScanResultSchema,
  SiteReadSchema,
} from "@agency-saas/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import { getFindingRemediation } from "@/lib/finding-remediation";
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

const severityRank = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
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
  const comparison = details.comparison;
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
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 lg:px-10">
      <ScanStatusRefresher active={pending} />

      <Link
        href={`/organizations/${organizationId}/sites/${siteId}`}
        className="text-sm text-white/45 transition hover:text-white/70"
      >
        ← Retour à {details.site.name}
      </Link>

      <section className="border-b border-white/10 py-10">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Résultat du scan
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {details.site.name}
            </h1>
            <p className="mt-3 break-all text-white/45">
              {details.site.canonicalUrl}
            </p>
          </div>
          <span className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/60">
            {scanStatusLabels[details.scan.status]}
          </span>
        </div>

        <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Déclenchement
            </dt>
            <dd className="mt-2 text-sm">
              {details.scan.trigger === "manual" ? "Manuel" : "Planifié"}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Mis en file
            </dt>
            <dd className="mt-2 text-sm">
              {formatDate(details.scan.queuedAt)}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Terminé
            </dt>
            <dd className="mt-2 text-sm">
              {formatDate(details.scan.completedAt)}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
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
            className="mt-6 rounded-2xl border border-sky-300/15 bg-sky-300/[0.05] p-5"
          >
            <div className="flex items-center gap-3">
              <span className="size-2.5 animate-pulse rounded-full bg-sky-300" />
              <p className="font-semibold text-sky-50">
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
          <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
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
              className="text-sm text-emerald-300 transition hover:text-emerald-200"
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
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                <dt className="text-xs uppercase tracking-[0.14em] text-white/35">
                  {label}
                </dt>
                <dd className="mt-2 text-2xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="py-10">
        <p className="text-sm text-white/45">Analyse</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          {orderedFindings.length} finding
          {orderedFindings.length > 1 ? "s" : ""}
        </h2>

        {orderedFindings.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-black/10 p-8">
            <p className="text-white/50">
              Aucun finding enregistré pour ce scan.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {orderedFindings.map((finding) => {
              const evidence = visibleEvidence(finding.evidence);
              const remediation = getFindingRemediation(finding.code);
              const change =
                comparison?.changesByFingerprint[finding.fingerprint];
              return (
                <article
                  key={finding.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.035] p-6"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-white/35">
                        {finding.category} · {finding.code}
                      </p>
                      <h3 className="mt-2 text-lg font-semibold">
                        {finding.title}
                      </h3>
                      {finding.pageUrl ? (
                        <p className="mt-2 break-all text-sm text-white/40">
                          {finding.pageUrl}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {change ? (
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1 text-xs text-emerald-200">
                          {findingChangeLabels[change.change]}
                          {change.previousSeverity &&
                          change.previousSeverity !== finding.severity
                            ? ` · ${severityLabels[change.previousSeverity]} → ${severityLabels[finding.severity]}`
                            : ""}
                        </span>
                      ) : null}
                      <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60">
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
                    <div className="mt-5 rounded-xl border border-sky-300/15 bg-sky-300/[0.045] p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200/70">
                        Comment corriger
                      </p>
                      <h4 className="mt-2 font-semibold text-sky-50">
                        {remediation.title}
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-white/55">
                        {remediation.summary}
                      </p>
                      <ol className="mt-4 space-y-2 text-sm leading-6 text-white/65">
                        {remediation.steps.map((step, index) => (
                          <li key={step} className="flex gap-3">
                            <span className="text-sky-300">{index + 1}.</span>
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
                  className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-emerald-200/60">
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
    </main>
  );
}
