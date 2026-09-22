import { OrganizationReadSchema } from "@agency-saas/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import {
  canManageOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "@/lib/organization-site-service";
import { SiteForm } from "./site-form";

type NewSitePageProps = {
  params: Promise<{ organizationId: string }>;
};

export default async function NewSitePage({ params }: NewSitePageProps) {
  const { organizationId } = await params;
  if (!OrganizationReadSchema.shape.id.safeParse(organizationId).success) {
    notFound();
  }

  const session = await requireCurrentSession();

  let access;
  try {
    access = await requireOrganizationAccess(session.user.id, organizationId);
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      notFound();
    }
    throw error;
  }

  if (!canManageOrganization(access.role)) {
    notFound();
  }
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-8 lg:px-10">
      <Link
        href={`/organizations/${organizationId}`}
        className="text-sm text-white/45 transition hover:text-white/70"
      >
        ← Retour à {access.organizationName}
      </Link>

      <section className="mt-10 rounded-2xl border border-white/10 bg-white/[0.035] p-7">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
          Nouveau site
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Ajouter un site à superviser
        </h1>
        <p className="mt-3 max-w-2xl leading-7 text-white/50">
          Le site sera créé en attente de vérification. Aucun scan ne sera lancé
          depuis cet écran.
        </p>
        <SiteForm organizationId={organizationId} />
      </section>
    </main>
  );
}
