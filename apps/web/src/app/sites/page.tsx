import Link from "next/link";
import { WorkspaceShell } from "@/components/product-shell";
import { getMonitoringState } from "@/lib/monitoring-state";
import { hasCurrentSiteOwnershipProof } from "@agency-saas/security";
import { getWorkspaceOverview } from "@/lib/workspace-overview";
import { fleetAttention } from "@/lib/fleet-attention";
import { SiteActionsMenu } from "./site-actions-menu";

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

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{
    organization?: string;
    urgency?: string;
    severity?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const { sites, createSiteHref } = await getWorkspaceOverview();
  const filters = await searchParams;
  const organizations = [
    ...new Map(
      sites.map((site) => [site.organizationId, site.organizationName]),
    ).entries(),
  ];
  const rows = sites
    .map((site) => ({ site, attention: fleetAttention(site) }))
    .filter(
      ({ site, attention }) =>
        (!filters.organization ||
          site.organizationId === filters.organization) &&
        (!filters.urgency ||
          filters.urgency === "all" ||
          attention.urgency === filters.urgency) &&
        (!filters.severity ||
          filters.severity === "all" ||
          (filters.severity === "critical"
            ? (site.latestScan?.criticalCount ?? 0) > 0
            : (site.latestScan?.highCount ?? 0) +
                (site.latestScan?.criticalCount ?? 0) >
              0)),
    );
  rows.sort((a, b) => {
    if (filters.sort === "activity")
      return (
        (b.site.latestScan?.queuedAt?.getTime() ?? 0) -
        (a.site.latestScan?.queuedAt?.getTime() ?? 0)
      );
    if (filters.sort === "name")
      return a.site.name.localeCompare(b.site.name, "fr");
    const rank = { urgent: 2, followup: 1, none: 0 };
    return (
      rank[b.attention.urgency] - rank[a.attention.urgency] ||
      (b.site.latestScan?.queuedAt?.getTime() ?? 0) -
        (a.site.latestScan?.queuedAt?.getTime() ?? 0)
    );
  });
  const requestedPage = Number(filters.page ?? 1);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const shownSites = rows.slice(
    (Math.min(page, pages) - 1) * 50,
    Math.min(page, pages) * 50,
  );
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    for (const key of [
      "organization",
      "urgency",
      "severity",
      "sort",
    ] as const) {
      if (filters[key]) query.set(key, filters[key]!);
    }
    query.set("page", String(target));
    return `/sites?${query.toString()}`;
  };

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
          <div className="flex flex-wrap gap-2">
            <Link
              href={createSiteHref.replace(/\/new$/, "/import")}
              className="am-button-secondary"
            >
              Importer un CSV
            </Link>
            <Link href={createSiteHref} className="am-button-primary">
              Ajouter un site <span aria-hidden="true">+</span>
            </Link>
          </div>
        ) : null}
      </section>

      <section className="py-9" aria-label="Liste des sites">
        <form
          method="get"
          className="am-panel mb-7 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5"
          aria-label="Filtres du parc"
        >
          <label className="text-xs text-[#9aa6b9]">
            Client ou organisation
            <select
              name="organization"
              className="am-field mt-1"
              defaultValue={filters.organization ?? ""}
            >
              <option value="">Toutes</option>
              {organizations.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[#9aa6b9]">
            Urgence
            <select
              name="urgency"
              className="am-field mt-1"
              defaultValue={filters.urgency ?? "all"}
            >
              <option value="all">Toutes</option>
              <option value="urgent">Action prioritaire</option>
              <option value="followup">À suivre</option>
              <option value="none">Sans signal</option>
            </select>
          </label>
          <label className="text-xs text-[#9aa6b9]">
            Gravité
            <select
              name="severity"
              className="am-field mt-1"
              defaultValue={filters.severity ?? "all"}
            >
              <option value="all">Toutes</option>
              <option value="critical">Critique</option>
              <option value="high">Élevée ou critique</option>
            </select>
          </label>
          <label className="text-xs text-[#9aa6b9]">
            Tri
            <select
              name="sort"
              className="am-field mt-1"
              defaultValue={filters.sort ?? "urgency"}
            >
              <option value="urgency">Urgence</option>
              <option value="activity">Dernière activité</option>
              <option value="name">Nom</option>
            </select>
          </label>
          <button className="am-button-secondary self-end">Appliquer</button>
        </form>
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
            {String(rows.length).padStart(2, "0")} /{" "}
            {String(sites.length).padStart(2, "0")}
          </span>
        </div>

        {shownSites.length === 0 ? (
          <div className="mt-7 border-l-2 border-[#6d7cff] bg-[#0d121d] p-6">
            <p className="text-sm text-[#7f8a9f]">
              {sites.length === 0
                ? "Aucun site enregistré."
                : "Aucun site ne correspond aux filtres."}
            </p>
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
            {shownSites.map(({ site, attention }) => {
              const scanActive =
                site.latestScan?.status === "queued" ||
                site.latestScan?.status === "running";
              const siteHref = `/organizations/${site.organizationId}/sites/${site.id}`;
              const monitoringState = getMonitoringState({
                status: site.status,
                verifiedAt: site.verifiedAt,
                ownershipCurrent: hasCurrentSiteOwnershipProof(site),
                scheduleEnabled: site.monitoringScheduleEnabled,
              });

              return (
                <div
                  key={site.id}
                  className="group grid gap-4 py-5 transition hover:bg-[#0d121d] sm:grid-cols-[1fr_190px_150px_auto] sm:items-center sm:px-4"
                >
                  <div className="min-w-0">
                    <Link href={siteHref}>
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
                        {site.organizationName} · {monitoringState.detail}
                      </p>
                      {attention.notes.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-xs text-amber-100/80">
                          {attention.notes.map((note) => (
                            <li key={note}>• {note}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-[#657188]">
                          Aucun signal prioritaire.
                        </p>
                      )}
                    </Link>
                    <Link
                      href={attention.action.href}
                      className="mt-3 inline-block text-sm font-semibold text-[#8793ff]"
                    >
                      {attention.action.label} →
                    </Link>
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
                    {attention.scanOverdue ? (
                      <p className="mt-1 text-xs text-amber-200">
                        Échéance du suivi dépassée :{" "}
                        {formatDate(site.monitoringNextRunAt)}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5f6b81]">
                      Constats
                    </p>
                    <p className="mt-2 text-sm text-[#cdd5e4]">
                      {site.latestScan?.findingCount ?? "—"}
                    </p>
                    {site.openFollowupCount > 0 ? (
                      <p className="mt-1 text-xs text-[#8793a8]">
                        {site.openFollowupCount} suivi(s) ouvert(s)
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <Link
                      href={siteHref}
                      aria-label={`Ouvrir ${site.name}`}
                      className="text-[#6d7cff] transition hover:translate-x-1 hover:text-[#aab2ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8793ff]"
                    >
                      →
                    </Link>
                    {site.canManage ? (
                      <SiteActionsMenu
                        organizationId={site.organizationId}
                        siteId={site.id}
                        siteName={site.name}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {pages > 1 ? (
          <nav
            aria-label="Pagination du parc"
            className="mt-6 flex items-center gap-4 text-sm"
          >
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="text-[#8793ff]">
                ← Précédent
              </Link>
            ) : null}
            <span>
              Page {Math.min(page, pages)} / {pages}
            </span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="text-[#8793ff]">
                Suivant →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </WorkspaceShell>
  );
}
