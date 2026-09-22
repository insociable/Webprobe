import { OrganizationReadSchema } from "@agency-saas/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { requireCurrentSession } from "@/lib/current-session";
import { getOrganizationOverview } from "@/lib/organization-overview";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { AlertPreferencePanel } from "./alert-preference-panel";
import { ManualScanButton } from "./manual-scan-button";

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
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 lg:px-10">
      <nav className="flex items-center justify-between border-b border-white/10 pb-6">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-300 font-black text-emerald-950">
            A
          </span>
          <div>
            <p className="font-semibold tracking-tight">Agency Monitor</p>
            <p className="text-xs text-white/45">Retour au tableau de bord</p>
          </div>
        </Link>
        <SignOutButton />
      </nav>

      <section className="flex flex-col gap-6 py-12 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
            Organisation
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            {overview.access.organizationName}
          </h1>
          <p className="mt-3 text-white/50">
            {overview.sites.length} site
            {overview.sites.length > 1 ? "s" : ""} configuré
            {overview.sites.length > 1 ? "s" : ""}
          </p>
        </div>

        {overview.access.role !== "member" ? (
          <Link
            href={`/organizations/${organizationId}/sites/new`}
            className="rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200"
          >
            Ajouter un site
          </Link>
        ) : null}
      </section>
      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <p className="text-xs uppercase tracking-[0.15em] text-white/35">
            Sites actifs
          </p>
          <p className="mt-2 text-2xl font-semibold">{activeSites}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <p className="text-xs uppercase tracking-[0.15em] text-white/35">
            Scans en cours
          </p>
          <p className="mt-2 text-2xl font-semibold">{scansInProgress}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <p className="text-xs uppercase tracking-[0.15em] text-white/35">
            Findings high / critical
          </p>
          <p className="mt-2 text-2xl font-semibold">{majorFindings}</p>
        </div>
      </section>

      {overview.access.role !== "member" ? (
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
      ) : null}

      {overview.sites.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-white/15 bg-black/10 p-8">
          <p className="text-sm text-white/45">Aucun site enregistré.</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Ajoutez le premier site à superviser.
          </h2>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {overview.sites.map((site) => {
            const scanActive =
              site.latestScan?.status === "queued" ||
              site.latestScan?.status === "running";

            return (
              <article
                key={site.id}
                className="rounded-2xl border border-white/10 bg-white/[0.035] p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">
                      <Link
                        href={`/organizations/${organizationId}/sites/${site.id}`}
                        className="transition hover:text-emerald-200"
                      >
                        {site.name}
                      </Link>
                    </h2>
                    <p className="mt-2 break-all text-sm text-white/45">
                      {site.canonicalUrl}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45">
                    {site.status === "active"
                      ? "Actif"
                      : site.status === "paused"
                        ? "En pause"
                        : "À vérifier"}
                  </span>
                </div>

                <div className="mt-5 rounded-xl border border-white/10 bg-black/10 p-4">
                  {site.latestScan ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">Dernier scan</p>
                        <span className="text-xs text-white/45">
                          {scanStatusLabels[site.latestScan.status]}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-white/40">
                        {formatDate(site.latestScan.queuedAt)}
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-white/35">Findings</p>
                          <p className="mt-1">
                            {site.latestScan.findingCount ?? "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-white/35">
                            High / critical
                          </p>
                          <p className="mt-1">
                            {site.latestScan.highCount} /{" "}
                            {site.latestScan.criticalCount}
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-white/45">
                      Aucun scan enregistré.
                    </p>
                  )}
                </div>

                {site.status === "pending_verification" &&
                overview.access.role !== "member" ? (
                  <Link
                    href={`/organizations/${organizationId}/sites/${site.id}/verify`}
                    className="mt-5 inline-flex rounded-lg border border-emerald-300/20 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:border-emerald-300/40 hover:bg-emerald-300/[0.05]"
                  >
                    Vérifier le domaine
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
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
