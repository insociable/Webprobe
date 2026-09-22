import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/product-shell";
import { ScanStatusRefresher } from "@/components/scan-status-refresher";
import { requireCurrentSession } from "@/lib/current-session";
import { getSiteScanHistory } from "@/lib/scan-history";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { getWeeklyScanScheduleForSite } from "@/lib/scan-schedule";
import { ManualScanButton } from "../../manual-scan-button";
import { ScanSchedulePanel } from "./scan-schedule-panel";

type SitePageProps = {
  params: Promise<{
    organizationId: string;
    siteId: string;
  }>;
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

export default async function SitePage({ params }: SitePageProps) {
  const { organizationId, siteId } = await params;

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

  const activeScan = history.scans.some(
    (scan) => scan.status === "queued" || scan.status === "running",
  );
  const canManage = history.access.role !== "member";

  return (
    <WorkspaceShell
      trail={[
        {
          label: history.access.organizationName,
          href: "/organizations/" + organizationId,
        },
        { label: history.site.name },
      ]}
    >
      <ScanStatusRefresher active={activeScan} />

      <section className="grid gap-7 border-b border-[#242d40] pb-9 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="am-kicker">Site surveillé</p>
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
                (history.site.status === "active"
                  ? "bg-[#51d3a5]"
                  : history.site.status === "paused"
                    ? "bg-[#ffb45f]"
                    : "bg-[#6d7cff]")
              }
            />
            {history.site.status === "active"
              ? "Domaine vérifié · supervision disponible"
              : history.site.status === "paused"
                ? "Supervision en pause"
                : "Domaine à vérifier"}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
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
              Vérifier le domaine
            </Link>
          ) : null}

          {history.site.status === "active" && canManage && !activeScan ? (
            <ManualScanButton organizationId={organizationId} siteId={siteId} />
          ) : null}
        </div>
      </section>

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
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#65ccef]">
            Live
          </span>
        </section>
      ) : null}

      <section className="py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
              Historique
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              Derniers scans
            </h2>
          </div>
          <span className="font-mono text-xs text-[#657188]">
            {String(history.scans.length).padStart(2, "0")}
          </span>
        </div>

        {history.scans.length === 0 ? (
          <div className="mt-6 border-l-2 border-[#46557a] bg-[#0d121d] p-7">
            <p className="text-[#7f8a9f]">
              Aucun scan n’a encore été exécuté pour ce site.
            </p>
          </div>
        ) : (
          <div className="mt-6 overflow-hidden border-y border-[#242d40]">
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
                      {scan.trigger === "manual"
                        ? "Scan manuel"
                        : "Scan planifié"}
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
      </section>

      <section className="border-t border-[#242d40] pt-9">
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
    </WorkspaceShell>
  );
}
