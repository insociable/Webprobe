import { OrganizationReadSchema } from "@agency-saas/contracts";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/product-shell";
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
    <WorkspaceShell
      trail={[
        {
          label: access.organizationName,
          href: "/organizations/" + organizationId,
        },
        { label: "Nouveau site" },
      ]}
    >
      <section className="max-w-3xl">
        <p className="am-kicker">Nouveau site</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
          Ajouter un site à superviser
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-[#8793a8]">
          Le site sera créé en attente de vérification. Aucun scan ne sera
          autorisé tant que le contrôle DNS n’aura pas confirmé que vous
          maîtrisez le domaine.
        </p>
      </section>

      <section className="am-panel mt-10 max-w-3xl p-6 sm:p-8">
        <div className="grid gap-6 sm:grid-cols-[150px_1fr]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#627087]">
              Étape 01 / 02
            </p>
            <div className="mt-4 h-px w-12 bg-[#6d7cff]" />
            <p className="mt-4 text-xs leading-5 text-[#68758c]">
              Déclarer le site avant la vérification DNS.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em]">
              Identité du site
            </h2>
            <p className="mt-3 leading-7 text-[#7f8a9f]">
              Renseignez le nom visible dans Agency Monitor et l’URL canonique
              qui servira de point d’entrée aux futurs scans.
            </p>
            <SiteForm organizationId={organizationId} />
          </div>
        </div>
      </section>
    </WorkspaceShell>
  );
}
