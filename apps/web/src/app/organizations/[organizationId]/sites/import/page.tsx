import { OrganizationReadSchema } from "@agency-saas/contracts";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/product-shell";
import { requireCurrentSession } from "@/lib/current-session";
import {
  canManageOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "@/lib/organization-site-service";
import { ImportForm } from "./import-form";

export default async function ImportSitesPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  if (!OrganizationReadSchema.shape.id.safeParse(organizationId).success)
    notFound();
  const session = await requireCurrentSession();
  let access;
  try {
    access = await requireOrganizationAccess(session.user.id, organizationId);
  } catch (error) {
    if (error instanceof OrganizationAccessError) notFound();
    throw error;
  }
  if (!canManageOrganization(access.role)) notFound();
  return (
    <WorkspaceShell trail={[{ label: "Sites" }, { label: "Import CSV" }]}>
      <section className="max-w-4xl">
        <p className="am-kicker">Gestion de parc</p>
        <h1 className="mt-4 text-4xl font-semibold">Importer des sites</h1>
        <p className="my-6 text-[#8793a8]">
          Vérifiez chaque ligne avant d’ajouter les sites à{" "}
          {access.organizationName}.
        </p>
        <ImportForm organizationId={organizationId} />
      </section>
    </WorkspaceShell>
  );
}
