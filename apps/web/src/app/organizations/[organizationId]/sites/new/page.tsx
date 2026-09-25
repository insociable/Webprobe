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
    <WorkspaceShell trail={[{ label: "Nouveau site" }]}>
      <section className="max-w-2xl">
        <p className="am-kicker">Public Audit</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
          Auditez un site
        </h1>
        <p className="mt-4 max-w-xl leading-7 text-[#8793a8]">
          Lancez une analyse bornée des éléments publiquement accessibles. Aucun
          pentest actif et aucune vérification DNS ne sont nécessaires.
        </p>

        <div className="am-panel mt-9 p-6 sm:p-8">
          <SiteForm organizationId={organizationId} />
        </div>

        <p className="mt-5 max-w-xl text-xs leading-5 text-[#59647a]">
          WebProbe respecte robots.txt, les budgets réseau et les limites du
          Public Audit. Certaines parties du site peuvent donc ne pas être
          analysées.
        </p>
      </section>
    </WorkspaceShell>
  );
}
