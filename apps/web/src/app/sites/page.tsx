import Link from "next/link";
import { WorkspaceShell } from "@/components/product-shell";
import { getMonitoringState } from "@/lib/monitoring-state";
import { getWorkspaceOverview } from "@/lib/workspace-overview";

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

export default async function SitesPage() {
  const { sites, createSiteHref } = await getWorkspaceOverview();

  return (
    <WorkspaceShell trail={[{ label: "Sites / Monitoring" }]}>
      <section className="grid gap-6 border-b border-[#242d40] pb-9 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="am-kicker">Sites / Monitoring</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            Vos sites
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-[#8793a8]">
            Gérez les sites suivis, leur vérification et l’état du monitoring
            depuis un seul endroit.
          </p>
        </div>
        {createSiteHref ? (
          <Link href={createSiteHref} className="am-button-primary">
            Ajouter un site <span aria-hidden="true">+</span>
          </Link>
        ) : null}
      </section>

      <section className="py-9" aria-label="Liste des sites">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
              Accès direct
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              Sites enregistrés
            </h2>
          </div>
          <span className="font-mono text-xs text-[#657188]">
            {String(sites.length).padStart(2, "0")}
          </span>
        </div>

        {sites.length === 0 ? (
          <div className="mt-7 border-l-2 border-[#6d7cff] bg-[#0d121d] p-6">
            <p className="text-sm text-[#7f8a9f]">Aucun site enregistré.</p>
            {createSiteHref ? (
              <Link
                href={createSiteHref}
                className="mt-4 inline-flex text-sm font-semibold text-[#8793ff] hover:text-[#aeb6ff]"
              >
                Ajouter un site →
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="mt-7 divide-y divide-[#242d40] border-b border-[#242d40]">
            {sites.map((site) => {
              const scanActive =
                site.latestScan?.status === "queued" ||
                site.latestScan?.status === "running";
              const monitoringState = getMonitoringState({
                status: site.status,
                verifiedAt: site.verifiedAt,
                scheduleEnabled: site.monitoringScheduleEnabled,
              });

              return (
                <Link
                  key={site.id}
                  href={`/organizations/${site.organizationId}/sites/${site.id}`}
                  className="group grid gap-4 py-5 transition hover:bg-[#0d121d] sm:grid-cols-[1fr_190px_150px_auto] sm:items-center sm:px-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-semibold text-[#e9edf6] group-hover:text-white">
                        {site.name}
                      </h3>
                      <span className="rounded-md border border-[#303a50] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#9aa6ba]">
                        {monitoringState.label}
                      </span>
                    </div>
                    <p className="mt-2 break-all text-sm text-[#6f7b91]">
                      {site.canonicalUrl}
                    </p>
                    <p className="mt-2 text-xs text-[#657188]">
                      {monitoringState.detail}
                    </p>
                  </div>

                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5f6b81]">
                      Dernier scan
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-sm text-[#cdd5e4]">
                      {scanActive ? (
                        <span className="size-1.5 animate-pulse rounded-sm bg-[#39c7ff]" />
                      ) : null}
                      {site.latestScan
                        ? scanStatusLabels[site.latestScan.status]
                        : "Aucun"}
                    </p>
                    {site.latestScan ? (
                      <p className="mt-1 text-xs text-[#657188]">
                        {formatDate(site.latestScan.queuedAt)}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5f6b81]">
                      Findings
                    </p>
                    <p className="mt-2 text-sm text-[#cdd5e4]">
                      {site.latestScan?.findingCount ?? "—"}
                    </p>
                  </div>

                  <span className="text-[#6d7cff] transition group-hover:translate-x-1 group-hover:text-[#aab2ff]">
                    →
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </WorkspaceShell>
  );
}
