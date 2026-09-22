import { OrganizationReadSchema } from "@agency-saas/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/product-shell";
import { ScanStatusRefresher } from "@/components/scan-status-refresher";
import { requireCurrentSession } from "@/lib/current-session";
import { getOrganizationOverview } from "@/lib/organization-overview";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { AlertPreferencePanel } from "./alert-preference-panel";
import { ManualScanButton } from "./manual-scan-button";
import { ReportBrandingPanel } from "./report-branding-panel";

type OrganizationPageProps = {
  params: Promise<{ organizationId: string }>;
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

export default async function OrganizationPage({
  params,
}: OrganizationPageProps) {
  const { organizationId } = await params;
  if (!OrganizationReadSchema.shape.id.safeParse(organizationId).success) {
    notFound();
  }

  const session = await requireCurrentSession();
  let overview;

  try {
    overview = await getOrganizationOverview(session.user.id, organizationId);
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      notFound();
    }
    throw error;
  }

  const activeSites = overview.sites.filter(
    (site) => site.status === "active",
  ).length;
  const scansInProgress = overview.sites.filter(
    (site) =>
      site.latestScan?.status === "queued" ||
      site.latestScan?.status === "running",
  ).length;
  const majorFindings = overview.sites.reduce(
    (total, site) =>
      total +
      (site.latestScan?.criticalCount ?? 0) +
      (site.latestScan?.highCount ?? 0),
    0,
  );

  return (
    <WorkspaceShell trail={[{ label: overview.access.organizationName }]}>
      <ScanStatusRefresher active={scansInProgress > 0} />

      <section className="flex flex-col gap-6 border-b border-[#242d40] pb-9 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="am-kicker">Organisation</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            {overview.access.organizationName}
          </h1>
          <p className="mt-4 text-[#8793a8]">
            {overview.sites.length} site
            {overview.sites.length > 1 ? "s" : ""} configuré
            {overview.sites.length > 1 ? "s" : ""}.
          </p>
        </div>

        {overview.access.role !== "member" ? (
          <Link
            href={"/organizations/" + organizationId + "/sites/new"}
            className="am-button-primary"
          >
            Ajouter un site
            <span aria-hidden="true">+</span>
          </Link>
        ) : null}
      </section>

      <section className="py-8">
        <div className="am-metric-grid">
          <div className="am-metric-cell">
            <p className="am-metric-label">Sites actifs</p>
            <p className="am-metric-value">{activeSites}</p>
          </div>
          <div className="am-metric-cell">
            <p className="am-metric-label">Scans en cours</p>
            <p className="am-metric-value">{scansInProgress}</p>
          </div>
          <div className="am-metric-cell">
            <p className="am-metric-label">High / critical</p>
            <p className="am-metric-value">{majorFindings}</p>
          </div>
        </div>
      </section>

      <section className="border-t border-[#242d40] pt-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
              Workflow principal
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              Parc surveillé
            </h2>
          </div>
          <span className="font-mono text-xs text-[#657188]">
            {String(overview.sites.length).padStart(2, "0")} sites
          </span>
        </div>

        {overview.sites.length === 0 ? (
          <div className="mt-6 border-l-2 border-[#6d7cff] bg-[#0d121d] p-7">
            <p className="text-sm text-[#7f8a9f]">Aucun site enregistré.</p>
            <h3 className="mt-2 text-xl font-semibold">
              Ajoutez le premier site à superviser.
            </h3>
          </div>
        ) : (
          <div className="mt-6 divide-y divide-[#242d40] border-y border-[#242d40]">
            {overview.sites.map((site, index) => {
              const scanActive =
                site.latestScan?.status === "queued" ||
                site.latestScan?.status === "running";

              return (
                <article key={site.id} className="py-6">
                  <div className="grid gap-5 lg:grid-cols-[48px_1fr_0.85fr_auto] lg:items-start">
                    <span className="font-mono text-xs text-[#56627a]">
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-lg font-semibold">
                          <Link
                            href={
                              "/organizations/" +
                              organizationId +
                              "/sites/" +
                              site.id
                            }
                            className="transition hover:text-[#9ba5ff]"
                          >
                            {site.name}
                          </Link>
                        </h3>
                        <span className="rounded-md border border-[#303a50] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#8290a6]">
                          {site.status === "active"
                            ? "Actif"
                            : site.status === "paused"
                              ? "En pause"
                              : "À vérifier"}
                        </span>
                      </div>
                      <p className="mt-2 break-all text-sm text-[#6f7b91]">
                        {site.canonicalUrl}
                      </p>

                      <div className="mt-5 flex flex-wrap gap-3">
                        {site.status === "pending_verification" &&
                        overview.access.role !== "member" ? (
                          <Link
                            href={
                              "/organizations/" +
                              organizationId +
                              "/sites/" +
                              site.id +
                              "/verify"
                            }
                            className="am-button-secondary"
                          >
                            Vérifier le domaine
                          </Link>
                        ) : null}

                        {scanActive && site.latestScan ? (
                          <Link
                            href={
                              "/organizations/" +
                              organizationId +
                              "/sites/" +
                              site.id +
                              "/scans/" +
                              site.latestScan.id
                            }
                            className="am-button-primary"
                          >
                            Suivre le scan
                            <span aria-hidden="true">→</span>
                          </Link>
                        ) : null}

                        {site.latestScan?.status === "completed" ? (
                          <Link
                            href={
                              "/organizations/" +
                              organizationId +
                              "/sites/" +
                              site.id +
                              "/scans/" +
                              site.latestScan.id
                            }
                            className="am-button-secondary"
                          >
                            Voir le rapport
                          </Link>
                        ) : null}

                        {site.status === "active" &&
                        overview.access.role !== "member" &&
                        !scanActive ? (
                          <ManualScanButton
                            organizationId={organizationId}
                            siteId={site.id}
                          />
                        ) : null}
                      </div>
                    </div>

                    <div className="border-l border-[#2b354b] pl-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#66738a]">
                        Dernier scan
                      </p>
                      {site.latestScan ? (
                        <>
                          <div className="mt-2 flex items-center gap-2">
                            {scanActive ? (
                              <span className="size-2 animate-pulse rounded-sm bg-[#39c7ff]" />
                            ) : null}
                            <p className="text-sm font-medium text-[#cdd5e4]">
                              {scanStatusLabels[site.latestScan.status]}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-[#67738a]">
                            {formatDate(site.latestScan.queuedAt)}
                          </p>
                          <div className="mt-4 grid grid-cols-2 gap-5">
                            <div>
                              <p className="font-mono text-[10px] uppercase text-[#5f6b81]">
                                Findings
                              </p>
                              <p className="mt-1 text-lg font-semibold">
                                {site.latestScan.findingCount ?? "—"}
                              </p>
                            </div>
                            <div>
                              <p className="font-mono text-[10px] uppercase text-[#5f6b81]">
                                H / C
                              </p>
                              <p className="mt-1 text-lg font-semibold">
                                {site.latestScan.highCount} /{" "}
                                {site.latestScan.criticalCount}
                              </p>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-[#6f7b91]">
                          Aucun scan enregistré.
                        </p>
                      )}
                    </div>

                    <Link
                      href={
                        "/organizations/" + organizationId + "/sites/" + site.id
                      }
                      aria-label={"Ouvrir " + site.name}
                      className="text-[#6676ff] transition hover:translate-x-1 hover:text-[#9ba5ff]"
                    >
                      →
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {overview.access.role !== "member" ? (
        <section className="mt-14 border-t border-[#242d40] pt-8">
          <div className="mb-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
              Configuration
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              Rapports et alertes
            </h2>
          </div>
          <ReportBrandingPanel
            organizationId={organizationId}
            brandName={overview.access.reportBrandName}
            accentColor={overview.access.reportAccentColor}
          />
          <AlertPreferencePanel
            organizationId={organizationId}
            enabled={overview.access.scanAlertEnabled}
            minimumSeverity={
              overview.access.scanAlertMinimumSeverity === "high" ||
              overview.access.scanAlertMinimumSeverity === "critical"
                ? overview.access.scanAlertMinimumSeverity
                : "medium"
            }
          />
        </section>
      ) : null}
    </WorkspaceShell>
  );
}
