"use server";

import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import {
  setSiteTechnologyVersion,
  TechnologyVersionError,
} from "@/lib/site-technology-version";

export type TechnologyVersionActionState = {
  error: string | null;
  saved: boolean;
};

export async function setTechnologyVersionAction(
  organizationId: string,
  siteId: string,
  observationId: string,
  _previousState: TechnologyVersionActionState,
  formData: FormData,
): Promise<TechnologyVersionActionState> {
  if (
    ![organizationId, siteId, observationId].every(
      (id) => SiteReadSchema.shape.id.safeParse(id).success,
    ) ||
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success
  ) {
    return { error: "Demande invalide.", saved: false };
  }
  const session = await requireCurrentSession();
  const rawVersion = formData.get("version");
  const remove = formData.get("remove") === "1";
  if (!remove && typeof rawVersion !== "string")
    return { error: "Version invalide.", saved: false };
  try {
    await setSiteTechnologyVersion({
      userId: session.user.id,
      organizationId,
      siteId,
      observationId,
      version: remove ? null : String(rawVersion).trim(),
    });
  } catch (error) {
    if (error instanceof TechnologyVersionError)
      return { error: error.message, saved: false };
    if (error instanceof OrganizationAccessError)
      return {
        error:
          "Vous n’êtes pas autorisé à renseigner une version pour ce site.",
        saved: false,
      };
    return {
      error: "La vérification du lot a échoué. Réessayez dans un instant.",
      saved: false,
    };
  }
  revalidatePath(`/organizations/${organizationId}/sites/${siteId}`);
  revalidatePath("/dashboard");
  return { error: null, saved: true };
}
