"use server";

import {
  OrganizationReadSchema,
  SiteCreateSchema,
} from "@agency-saas/contracts";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import {
  createSiteForOrganization,
  OrganizationAccessError,
} from "@/lib/organization-site-service";
import { hasPostgresErrorCode } from "@/lib/postgres-error";

export type CreateSiteActionState = {
  error: string | null;
};

export async function createSiteAction(
  organizationId: string,
  _previousState: CreateSiteActionState,
  formData: FormData,
): Promise<CreateSiteActionState> {
  if (!OrganizationReadSchema.shape.id.safeParse(organizationId).success) {
    return { error: "Organisation invalide." };
  }

  const session = await requireCurrentSession();
  const parsed = SiteCreateSchema.safeParse({
    name: formData.get("name"),
    canonicalUrl: formData.get("canonicalUrl"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Informations du site invalides.",
    };
  }

  try {
    await createSiteForOrganization(
      session.user.id,
      organizationId,
      parsed.data,
    );
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      return { error: "Vous n’êtes pas autorisé à ajouter un site." };
    }

    if (hasPostgresErrorCode(error, "23505")) {
      return { error: "Ce site existe déjà dans cette organisation." };
    }

    console.error("Site creation failed");
    return { error: "Impossible d’ajouter le site pour le moment." };
  }

  redirect(`/organizations/${organizationId}`);
}
