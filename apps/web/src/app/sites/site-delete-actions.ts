"use server";

import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import {
  deleteSiteForOrganization,
  SiteDeletionError,
} from "@/lib/site-deletion-service";

export type DeleteSiteActionState = {
  error: string | null;
};

export async function deleteSiteAction(
  organizationId: string,
  siteId: string,
  expectedSiteName: string,
  _previousState: DeleteSiteActionState,
  formData: FormData,
): Promise<DeleteSiteActionState> {
  if (!OrganizationReadSchema.shape.id.safeParse(organizationId).success) {
    return { error: "Organisation invalide." };
  }
  if (!SiteReadSchema.shape.id.safeParse(siteId).success) {
    return { error: "Site invalide." };
  }

  const confirmation = formData.get("confirmation");
  if (
    typeof confirmation !== "string" ||
    confirmation.trim() !== expectedSiteName.trim()
  ) {
    return {
      error: "Saisissez exactement le nom du site pour confirmer.",
    };
  }

  const session = await requireCurrentSession();

  try {
    const result = await deleteSiteForOrganization(
      session.user.id,
      organizationId,
      siteId,
    );
    if (result.artifactCleanupFailures > 0) {
      console.error("Site deleted with artifact cleanup failures", {
        organizationId,
        siteId,
        artifactCleanupFailures: result.artifactCleanupFailures,
      });
    }
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      return { error: "Vous n’êtes pas autorisé à supprimer ce site." };
    }
    if (error instanceof SiteDeletionError) {
      if (error.code === "site-not-found") {
        return { error: "Ce site n’existe plus dans cette organisation." };
      }
      if (error.code === "scan-active") {
        return {
          error:
            "Un scan est encore en cours. Attendez sa fin avant de supprimer le site.",
        };
      }
      return {
        error:
          "La suppression est bloquée car une capture du site est invalide.",
      };
    }

    console.error("Site deletion failed", {
      organizationId,
      siteId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { error: "Impossible de supprimer le site pour le moment." };
  }

  redirect("/sites");
}
