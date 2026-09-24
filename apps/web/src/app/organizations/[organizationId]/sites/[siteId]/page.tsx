import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/product-shell";
import { ScanStatusRefresher } from "@/components/scan-status-refresher";
import { requireCurrentSession } from "@/lib/current-session";
import { getSiteScanHistory } from "@/lib/scan-history";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { getWeeklyScanScheduleForSite } from "@/lib/scan-schedule";
import { getMonitoringState } from "@/lib/monitoring-state";
import { ManualScanButton } from "../../manual-scan-button";
import { PublicAuditButton } from "../../public-audit-button";
import { ScanSchedulePanel } from "./scan-schedule-panel";
import { AlertPreferencePanel } from "../../alert-preference-panel";
import { ReportBrandingPanel } from "../../report-branding-panel";

type SitePageProps = {
  params: Promise<{
    organizationId: string;
    siteId: string;
  }>;
  searchParams: Promise<{ audit?: string }>;
};

const scanStatusLabels = {
  queued: "En file",
  running: "En cours",
  completed: "Terminé",
  failed: "Échec",
  cancelled: "Annulé",
} as const;

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(value);
}

function findingCount(summary: Record<string, unknown>): number | null {
  const value = summary.findingCount;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function loadSiteHistory(
  userId: string,
  organizationId: string,
  siteId: string,
) {
  try {
    return await getSiteScanHistory(userId, organizationId, siteId);
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      notFound();
    }
    throw error;
  }
}

async function loadSiteSchedule(
  userId: string,
  organizationId: string,
  siteId: string,
) {
  try {
    return await getWeeklyScanScheduleForSite(userId, organizationId, siteId);
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      notFound();
    }
    throw error;
  }
}

export default async function SitePage({
  params,
  searchParams,
}: SitePageProps) {
  const { organizationId, siteId } = await params;
  const { audit } = await searchParams;

  if (
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success ||
    !SiteReadSchema.shape.id.safeParse(siteId).success
  ) {
    notFound();
  }

  const session = await requireCurrentSession();
  const history = await loadSiteHistory(
    session.user.id,
    organizationId,
    siteId,
  );

  if (!history) {
    notFound();
  }

  const scheduleState = await loadSiteSchedule(
    session.user.id,
    organizationId,
    siteId,
  );

  const activeScanEntry =
    history.scans.find(
      (scan) => scan.status === "queued" || scan.status === "running",
    ) ?? null;
  const activeScan = Boolean(activeScanEntry);
  const latestScan = history.scans[0] ?? null;
  const latestScanCompleted = latestScan?.status === "completed";
  const latestScanRetryable =
    !latestScan ||
    latestScan.status === "failed" ||
    latestScan.status === "cancelled";
  const canManage = history.access.role !== "member";
  const monitoringState = getMonitoringState({
    status: history.site.status,
    verifiedAt: history.site.verifiedAt,
    scheduleEnabled: scheduleState?.schedule?.enabled ?? false,
  });

  return (
    <WorkspaceShell trail={[{ label: history.site.name }]}>
      <ScanStatusRefresher active={activeScan} />

      <section className="grid gap-7 border-b border-[#242d40] pb-9 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="am-kicker">
            {monitoringState.key === "verification_required"
              ? "Site à auditer"
              : monitoringState.key === "paused"
                ? "Site en pause"
                : "Site vérifié"}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            {history.site.name}
          </h1>
          <p className="mt-3 break-all text-[#7f8a9f]">
            {history.site.canonicalUrl}
          </p>
          <div className="mt-4 flex items-center gap-2 text-sm text-[#9ca7ba]">
            <span
              className={
                "size-2 rounded-sm " +
                (monitoringState.key === "active"
                  ? "bg-[#51d3a5]"
                  : monitoringState.key === "inactive" ||
                      monitoringState.key === "paused"
                    ? "bg-[#ffb45f]"
                    : "bg-[#6d7cff]")
              }
            />
            <span>
              <strong className="font-semibold text-[#dfe5f2]">
                {monitoringState.label}
              </strong>
              <span className="ml-2 text-[#7f8a9f]">
                {monitoringState.detail}
              </span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {history.site.status === "pending_verification" &&
          latestScanRetryable &&
          !activeScan ? (
            <PublicAuditButton
              organizationId={organizationId}
              siteId={siteId}
              label={
                latestScan ? "Relancer l’audit public" : "Lancer l’audit public"
              }
            />
          ) : null}

          {history.site.status === "pending_verification" &&
          latestScanCompleted &&
          latestScan ? (
            <Link
              href={
                "/organizations/" +
                organizationId +
                "/sites/" +
                siteId +
                "/scans/" +
                latestScan.id
              }
              className="am-button-primary"
            >
              Voir le rapport
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}

          {history.site.status === "pending_verification" && canManage ? (
            <Link
              href={
                "/organizations/" +
                organizationId +
                "/sites/" +
                siteId +
                "/verify"
              }
              className="am-button-secondary"
            >
              Activer le monitoring
            </Link>
          ) : null}

          {history.site.status === "pending_verification" &&
          latestScanCompleted &&
          !activeScan ? (
            <PublicAuditButton
              organizationId={organizationId}
              siteId={siteId}
              appearance="link"
              label="Relancer l’audit"
            />
          ) : null}

          {monitoringState.key === "inactive" && canManage ? (
            <a href="#monitoring-planning" className="am-button-secondary">
              Activer le monitoring
            </a>
          ) : null}

          {history.site.status === "active" && canManage && !activeScan ? (
            <ManualScanButton organizationId={organizationId} siteId={siteId} />
          ) : null}
        </div>
      </section>

      {history.site.status === "pending_verification" ? (
        <section className="mt-7 border-l-2 border-[#6d7cff] bg-[#0f1421] p-5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8793ff]">
            Monitoring verrouillé
          </p>
          <h2 className="mt-2 text-lg font-semibold">
            La vérification DNS débloque le suivi continu
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/50">
            Tant que le domaine n’est pas vérifié, WebProbe reste en audit
            public one-shot. La validation active ensuite le planning, les
            alertes de monitoring et le partage de rapports. Les audits publics
            déjà réalisés restent associés au site et distincts du monitoring ;
            leur conservation suit la politique de rétention configurée.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["Planning", "Alertes", "Partage de rapports"].map((item) => (
              <span
                key={item}
                className="rounded-md border border-[#303a50] bg-[#111827] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#aeb9cc]"
              >
                {item}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {audit === "deferred" ? (
        <section className="mt-7 border-l-2 border-amber-300/70 bg-amber-200/[0.05] p-5">
          <p className="font-semibold text-amber-100">Site créé.</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-100/70">
            L’audit public n’a pas pu démarrer automatiquement, par exemple à
            cause d’un quota, d’un cooldown ou d’un scan déjà actif. Vous pouvez
            le relancer avec le bouton ci-dessus.
          </p>
        </section>
      ) : null}

      {activeScan ? (
        <section
          aria-live="polite"
          className="mt-7 grid gap-4 border-l-2 border-[#39c7ff] bg-[#0b141d] p-5 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div>
            <div className="flex items-center gap-3">
              <span className="size-2 animate-pulse rounded-sm bg-[#39c7ff]" />
              <p className="font-semibold text-[#dff7ff]">Scan en cours</p>
            </div>
            <p className="mt-2 text-sm text-[#7f96a6]">
              Le statut se met à jour automatiquement. Ouvrez le scan actif
              ci-dessous pour suivre sa progression.
            </p>
          </div>
          {activeScanEntry ? (
            <Link
              href={
                "/organizations/" +
                organizationId +
                "/sites/" +
                siteId +
                "/scans/" +
                activeScanEntry.id
              }
              className="text-sm font-semibold text-[#65ccef] hover:text-[#a6eaff]"
            >
              Suivre le scan →
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="py-10">
        <details className="am-scan-history overflow-hidden border-y border-[#242d40]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-1 py-5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8793ff] sm:px-4">
            <span>Historique des scans · {history.scans.length}</span>
            <span
              aria-hidden="true"
              className="am-scan-history-chevron text-[#7685ff]"
            >
              ↓
            </span>
          </summary>

          {history.scans.length === 0 ? (
            <div className="border-t border-[#242d40] p-6">
              <p className="text-[#7f8a9f]">
                Aucun scan n’a encore été exécuté pour ce site.
              </p>
            </div>
          ) : (
            <div className="border-t border-[#242d40]">
              {history.scans.map((scan, index) => {
                const count = findingCount(scan.summary);
                const isActive =
                  scan.status === "queued" || scan.status === "running";

                return (
                  <Link
                    key={scan.id}
                    href={
                      "/organizations/" +
                      organizationId +
                      "/sites/" +
                      siteId +
                      "/scans/" +
                      scan.id
                    }
                    className="group grid gap-4 border-b border-[#242d40] px-1 py-5 transition last:border-b-0 hover:bg-[#0d121d] sm:grid-cols-[42px_1fr_150px_120px_auto] sm:items-center sm:px-4"
                  >
                    <span className="font-mono text-xs text-[#56627a]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p className="font-medium text-[#e2e7f1]">
                        {scan.scanMode === "public_audit"
                          ? "Audit public"
                          : scan.scanMode === "verified_deep_audit"
                            ? "Audit approfondi"
                            : scan.trigger === "manual"
                              ? "Monitoring manuel"
                              : "Monitoring planifié"}
                      </p>
                      <p className="mt-1 text-sm text-[#68758c]">
                        {formatDate(scan.queuedAt)}
                      </p>
                    </div>
                    <div className="text-sm text-[#8d98ad]">
                      {count === null
                        ? "Résultat en attente"
                        : count + " finding" + (count > 1 ? "s" : "")}
                    </div>
                    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#9aa6ba]">
                      {isActive ? (
                        <span className="size-1.5 animate-pulse rounded-sm bg-[#39c7ff]" />
                      ) : null}
                      {scanStatusLabels[scan.status]}
                    </span>
                    <span className="text-sm font-semibold text-[#7685ff] transition group-hover:translate-x-1 group-hover:text-[#aab2ff]">
                      {scan.status === "completed"
                        ? "Rapport →"
                        : isActive
                          ? "Suivre →"
                          : "Détail →"}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </details>
      </section>

      <section
        id="monitoring-planning"
        className="scroll-mt-24 border-t border-[#242d40] pt-9"
      >
        <div className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
            Automatisation
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
            Planning du scan
          </h2>
        </div>
        <ScanSchedulePanel
          organizationId={organizationId}
          siteId={siteId}
          canManage={canManage}
          siteActive={
            history.site.status === "active" && Boolean(history.site.verifiedAt)
          }
          schedule={
            scheduleState?.schedule
              ? {
                  enabled: scheduleState.schedule.enabled,
                  dayOfWeek: scheduleState.schedule.dayOfWeek,
                  minuteOfDay: scheduleState.schedule.minuteOfDay,
                  timeZone: scheduleState.schedule.timeZone,
                  nextRunAt:
                    scheduleState.schedule.nextRunAt?.toISOString() ?? null,
                }
              : null
          }
        />
      </section>

      {canManage ? (
        <section className="mt-10 border-t border-[#242d40] pt-9">
          <div className="mb-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
              Préférences
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              Rapports et alertes
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#6f7b91]">
              Configurez ici la présentation des rapports et les alertes de
              dégradation utilisées depuis votre portail.
            </p>
          </div>

          <ReportBrandingPanel
            organizationId={organizationId}
            brandName={history.access.reportBrandName}
            accentColor={history.access.reportAccentColor}
          />
          <AlertPreferencePanel
            organizationId={organizationId}
            enabled={history.access.scanAlertEnabled}
            minimumSeverity={
              history.access.scanAlertMinimumSeverity === "high" ||
              history.access.scanAlertMinimumSeverity === "critical"
                ? history.access.scanAlertMinimumSeverity
                : "medium"
            }
          />
        </section>
      ) : null}
    </WorkspaceShell>
  );
}
