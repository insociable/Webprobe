"use server";

import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { createPublicAuditForSite, PublicAuditError } from "@/lib/public-audit";

export type PublicAuditActionState = {
  error: string | null;
  message: string | null;
};

function humanPublicAuditError(error: unknown): string {
  if (error instanceof OrganizationAccessError) {
    return "Vous n’êtes pas autorisé à lancer cet audit.";
  }

  if (error instanceof PublicAuditError) {
    switch (error.code) {
      case "site-not-found":
        return "Site introuvable.";
      case "site-not-eligible":
        return "Ce site ne peut pas être audité dans son état actuel.";
      case "user-hourly-limit":
        return "Quota horaire d’audits publics atteint. Réessayez plus tard.";
      case "user-concurrency-limit":
        return "Trop d’audits publics sont déjà en cours sur votre compte.";
      case "domain-busy":
      case "scan-already-running":
        return "Un audit est déjà en file ou en cours pour ce domaine.";
      case "domain-cooldown":
        return "Ce domaine a été audité récemment. Réessayez après le délai de sécurité.";
    }
  }

  return "Impossible de lancer l’audit public pour le moment.";
}

export async function startPublicAuditAction(
  organizationId: string,
  siteId: string,
  _previousState: PublicAuditActionState,
  _formData: FormData,
): Promise<PublicAuditActionState> {
  void _previousState;
  void _formData;

  if (
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success ||
    !SiteReadSchema.shape.id.safeParse(siteId).success
  ) {
    return { error: "Site invalide.", message: null };
  }

  const session = await requireCurrentSession();
  let scan: Awaited<ReturnType<typeof createPublicAuditForSite>>;

  try {
    scan = await createPublicAuditForSite(
      session.user.id,
      organizationId,
      siteId,
    );
  } catch (error) {
    return { error: humanPublicAuditError(error), message: null };
  }

  revalidatePath(`/organizations/${organizationId}`);
  revalidatePath(`/organizations/${organizationId}/sites/${siteId}`);
  redirect(`/organizations/${organizationId}/sites/${siteId}/scans/${scan.id}`);
}
