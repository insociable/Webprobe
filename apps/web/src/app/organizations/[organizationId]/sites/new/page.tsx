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
      currentOrganizationId={organizationId}
      trail={[{ label: "Nouveau site" }]}
    >
      <section className="max-w-3xl">
        <p className="am-kicker">Audit public</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
          Auditer un site public
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-[#8793a8]">
          Agency Monitor analysera uniquement ce qu’un visiteur public peut
          observer, sans authentification ni action intrusive. La vérification
          DNS n’est nécessaire que pour activer ensuite le monitoring continu.
        </p>
      </section>

      <section className="am-panel mt-10 max-w-3xl p-6 sm:p-8">
        <div className="grid gap-6 sm:grid-cols-[150px_1fr]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#627087]">
              Audit one-shot
            </p>
            <div className="mt-4 h-px w-12 bg-[#6d7cff]" />
            <p className="mt-4 text-xs leading-5 text-[#68758c]">
              Créer le site et lancer immédiatement l’audit public.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em]">
              Cible publique
            </h2>
            <p className="mt-3 leading-7 text-[#7f8a9f]">
              Renseignez le nom visible dans Agency Monitor et l’URL publique
              qui servira de point d’entrée à l’audit.
            </p>
            <SiteForm organizationId={organizationId} />
          </div>
        </div>
      </section>
    </WorkspaceShell>
  );
}
