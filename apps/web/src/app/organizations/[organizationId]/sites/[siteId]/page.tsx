import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import { ManualScanButton } from "../../manual-scan-button";
import { getSiteScanHistory } from "@/lib/scan-history";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { getWeeklyScanScheduleForSite } from "@/lib/scan-schedule";
import { ScanSchedulePanel } from "./scan-schedule-panel";
import { ScanStatusRefresher } from "@/components/scan-status-refresher";

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
  if (!value) {
    return "—";
  }

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
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 lg:px-10">
      <ScanStatusRefresher active={activeScan} />

      <Link
        href={`/organizations/${organizationId}`}
        className="text-sm text-white/45 transition hover:text-white/70"
      >
        ← Retour à {history.access.organizationName}
      </Link>

      <section className="flex flex-col gap-6 border-b border-white/10 py-10 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
            Site
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            {history.site.name}
          </h1>
          <p className="mt-3 break-all text-white/45">
            {history.site.canonicalUrl}
          </p>
          <p className="mt-3 text-sm text-white/45">
            {history.site.status === "active"
              ? "Domaine vérifié"
              : history.site.status === "paused"
                ? "Supervision en pause"
                : "Domaine à vérifier"}
          </p>
        </div>

        <div>
          {history.site.status === "pending_verification" && canManage ? (
            <Link
              href={`/organizations/${organizationId}/sites/${siteId}/verify`}
              className="inline-flex rounded-xl border border-emerald-300/20 px-5 py-3 text-sm font-semibold text-emerald-200 transition hover:border-emerald-300/40"
            >
              Vérifier le domaine
            </Link>
          ) : null}

          {history.site.status === "active" && canManage && !activeScan ? (
            <ManualScanButton organizationId={organizationId} siteId={siteId} />
          ) : null}

          {activeScan ? (
            <p className="rounded-xl border border-white/10 px-4 py-3 text-sm text-white/55">
              Un scan est en cours. Cette page se rafraîchit automatiquement.
            </p>
          ) : null}
        </div>
      </section>

      <section className="border-b border-white/10 py-10">
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

      <section className="py-10">
        <div>
          <p className="text-sm text-white/45">Historique</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Derniers scans
          </h2>
        </div>

        {history.scans.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-black/10 p-8">
            <p className="text-white/50">
              Aucun scan n’a encore été exécuté pour ce site.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {history.scans.map((scan) => {
              const count = findingCount(scan.summary);
              return (
                <Link
                  key={scan.id}
                  href={`/organizations/${organizationId}/sites/${siteId}/scans/${scan.id}`}
                  className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-5 transition hover:border-white/20 md:grid-cols-[1fr_auto_auto_auto]"
                >
                  <div>
                    <p className="font-medium">
                      {scan.trigger === "manual"
                        ? "Scan manuel"
                        : "Scan planifié"}
                    </p>
                    <p className="mt-1 text-sm text-white/40">
                      Lancé le {formatDate(scan.queuedAt)}
                    </p>
                  </div>
                  <div className="text-sm text-white/55">
                    {count === null
                      ? "Résultat en attente"
                      : `${count} finding${count > 1 ? "s" : ""}`}
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-center text-xs text-white/60">
                    {scanStatusLabels[scan.status]}
                  </span>
                  <span className="self-center text-sm font-semibold text-sky-200">
                    {scan.status === "completed"
                      ? "Voir le rapport →"
                      : scan.status === "queued" || scan.status === "running"
                        ? "Suivre →"
                        : "Voir le détail →"}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
