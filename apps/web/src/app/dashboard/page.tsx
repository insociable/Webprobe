import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/product-shell";
import { requireCurrentSession } from "@/lib/current-session";
import { getUserMemberships } from "@/lib/membership-context";
import { getOrganizationOverview } from "@/lib/organization-overview";

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

export default async function DashboardPage() {
  const session = await requireCurrentSession();
  const userMemberships = await getUserMemberships(session.user.id);

  if (userMemberships.length === 0) {
    redirect("/onboarding");
  }

  const overviews = await Promise.all(
    userMemberships.map((membership) =>
      getOrganizationOverview(session.user.id, membership.organizationId),
    ),
  );
  const workspaces = userMemberships.map((membership, index) => ({
    membership,
    overview: overviews[index]!,
  }));
  const allSites = workspaces.flatMap(({ membership, overview }) =>
    overview.sites.map((site) => ({
      ...site,
      organizationId: membership.organizationId,
      role: membership.role,
    })),
  );
  const manageableMemberships = userMemberships.filter(
    (membership) => membership.role !== "member",
  );
  const directCreateHref =
    manageableMemberships.length === 1
      ? "/organizations/" +
        manageableMemberships[0]!.organizationId +
        "/sites/new"
      : null;
  const scansInProgress = allSites.filter(
    (site) =>
      site.latestScan?.status === "queued" ||
      site.latestScan?.status === "running",
  ).length;
  const majorFindings = allSites.reduce(
    (total, site) =>
      total +
      (site.latestScan?.highCount ?? 0) +
      (site.latestScan?.criticalCount ?? 0),
    0,
  );
  const emailFallbackName = session.user.email.split("@")[0] ?? "";
  const hasCustomDisplayName =
    session.user.name !== "Utilisateur" &&
    session.user.name.trim().toLowerCase() !==
      emailFallbackName.trim().toLowerCase();

  return (
    <WorkspaceShell>
      <section className="grid gap-8 border-b border-[#242d40] pb-9 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="am-kicker">Vue générale</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            {hasCustomDisplayName
              ? "Bonjour " + session.user.name
              : "Votre espace"}
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-[#8793a8]">
            Retrouvez vos sites directement ici. Un nouveau site peut être
            audité immédiatement ; la vérification DNS ne sert qu’à activer le
            monitoring continu.
          </p>
        </div>
        {directCreateHref ? (
          <Link href={directCreateHref} className="am-button-primary">
            Ajouter un site
            <span aria-hidden="true">+</span>
          </Link>
        ) : null}
      </section>

      <section className="border-b border-[#242d40] py-7">
        <div className="am-metric-grid">
          <div className="am-metric-cell">
            <p className="am-metric-label">Sites</p>
            <p className="am-metric-value">{allSites.length}</p>
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

      <section id="sites" className="py-9">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
              Accès direct
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              Vos sites
            </h2>
          </div>
          <span className="font-mono text-xs text-[#657188]">
            {String(allSites.length).padStart(2, "0")}
          </span>
        </div>

        <div className="mt-7 space-y-10">
          {workspaces.map(({ membership, overview }) => (
            <section key={membership.organizationId}>
              {workspaces.length > 1 ? (
                <div className="flex items-center justify-between border-b border-[#242d40] pb-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#647188]">
                    {membership.organizationName}
                  </p>
                  {membership.role !== "member" ? (
                    <Link
                      href={
                        "/organizations/" +
                        membership.organizationId +
                        "/sites/new"
                      }
                      className="text-xs font-medium text-[#8793ff] hover:text-[#aeb6ff]"
                    >
                      Ajouter un site +
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {overview.sites.length === 0 ? (
                <div className="mt-5 border-l-2 border-[#6d7cff] bg-[#0d121d] p-6">
                  <p className="text-sm text-[#7f8a9f]">
                    Aucun site enregistré dans cet espace.
                  </p>
                  {membership.role !== "member" ? (
                    <Link
                      href={
                        "/organizations/" +
                        membership.organizationId +
                        "/sites/new"
                      }
                      className="mt-4 inline-flex text-sm font-semibold text-[#8793ff] hover:text-[#aeb6ff]"
                    >
                      Ajouter le premier site →
                    </Link>
                  ) : null}
                </div>
              ) : (
                <div className="divide-y divide-[#242d40] border-b border-[#242d40]">
                  {overview.sites.map((site) => {
                    const scanActive =
                      site.latestScan?.status === "queued" ||
                      site.latestScan?.status === "running";
                    const statusLabel =
                      site.status === "active"
                        ? "Monitoring activé"
                        : site.status === "paused"
                          ? "En pause"
                          : "Audit public disponible";

                    return (
                      <Link
                        key={site.id}
                        href={
                          "/organizations/" +
                          membership.organizationId +
                          "/sites/" +
                          site.id
                        }
                        className="group grid gap-4 py-5 transition hover:bg-[#0d121d] sm:grid-cols-[1fr_190px_150px_auto] sm:items-center sm:px-4"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="font-semibold text-[#e9edf6] group-hover:text-white">
                              {site.name}
                            </h3>
                            <span className="rounded-md border border-[#303a50] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#9aa6ba]">
                              {statusLabel}
                            </span>
                          </div>
                          <p className="mt-2 break-all text-sm text-[#6f7b91]">
                            {site.canonicalUrl}
                          </p>
                          {site.status === "pending_verification" ? (
                            <p className="mt-2 text-xs text-[#657188]">
                              Le DNS n’est requis que pour le monitoring continu
                              et le partage public.
                            </p>
                          ) : null}
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
          ))}
        </div>
      </section>
    </WorkspaceShell>
  );
}
