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
import { createPublicAuditForSite } from "@/lib/public-audit";
import { deriveSiteDisplayName } from "@/lib/site-display-name";

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
  const parsedUrl = SiteCreateSchema.shape.canonicalUrl.safeParse(
    formData.get("canonicalUrl"),
  );
  if (!parsedUrl.success) {
    return {
      error: parsedUrl.error.issues[0]?.message ?? "URL du site invalide.",
    };
  }

  const requestedName = formData.get("name");
  const parsed = SiteCreateSchema.safeParse({
    canonicalUrl: parsedUrl.data,
    name: deriveSiteDisplayName(
      parsedUrl.data,
      typeof requestedName === "string" ? requestedName : null,
    ),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Informations du site invalides.",
    };
  }

  let site: Awaited<ReturnType<typeof createSiteForOrganization>>;
  try {
    site = await createSiteForOrganization(
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

  let scan: Awaited<ReturnType<typeof createPublicAuditForSite>>;
  try {
    scan = await createPublicAuditForSite(
      session.user.id,
      organizationId,
      site.id,
    );
  } catch (error) {
    console.error("Initial public audit launch failed", error);
    redirect(
      `/organizations/${organizationId}/sites/${site.id}?audit=deferred`,
    );
  }

  redirect(
    `/organizations/${organizationId}/sites/${site.id}/scans/${scan.id}`,
  );
}
