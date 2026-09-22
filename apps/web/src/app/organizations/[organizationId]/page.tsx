import { OrganizationReadSchema } from "@agency-saas/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { requireCurrentSession } from "@/lib/current-session";
import {
  OrganizationAccessError,
  listSitesForOrganization,
  requireOrganizationAccess,
} from "@/lib/organization-site-service";

type OrganizationPageProps = {
  params: Promise<{ organizationId: string }>;
};

export default async function OrganizationPage({
  params,
}: OrganizationPageProps) {
  const { organizationId } = await params;
  if (!OrganizationReadSchema.shape.id.safeParse(organizationId).success) {
    notFound();
  }

  const session = await requireCurrentSession();

  let access;
  let organizationSites;

  try {
    [access, organizationSites] = await Promise.all([
      requireOrganizationAccess(session.user.id, organizationId),
      listSitesForOrganization(session.user.id, organizationId),
    ]);
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      notFound();
    }
    throw error;
  }

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
            {access.organizationName}
          </h1>
          <p className="mt-3 text-white/50">
            {organizationSites.length} site
            {organizationSites.length > 1 ? "s" : ""} configuré
            {organizationSites.length > 1 ? "s" : ""}
          </p>
        </div>

        {access.role !== "member" ? (
          <Link
            href={`/organizations/${organizationId}/sites/new`}
            className="rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200"
          >
            Ajouter un site
          </Link>
        ) : null}
      </section>
      {organizationSites.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-white/15 bg-black/10 p-8">
          <p className="text-sm text-white/45">Aucun site enregistré.</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Ajoutez le premier site à superviser.
          </h2>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {organizationSites.map((site) => (
            <article
              key={site.id}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{site.name}</h2>
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
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
