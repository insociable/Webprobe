"use server";

import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import {
  createDeepScanForSite,
  createManualScanForSite,
  ManualScanError,
} from "@/lib/manual-scan";
import { OrganizationAccessError } from "@/lib/organization-site-service";

export type ManualScanActionState = {
  error: string | null;
  message: string | null;
};

const initialManualScanActionState: ManualScanActionState = {
  error: null,
  message: null,
};

function humanScanError(error: unknown): string {
  if (error instanceof OrganizationAccessError) {
    return "Vous n’êtes pas autorisé à lancer un scan.";
  }

  if (error instanceof ManualScanError) {
    switch (error.code) {
      case "site-not-found":
        return "Site introuvable.";
      case "site-not-active":
        return "Le domaine doit être vérifié avant de lancer un scan.";
      case "scan-already-running":
        return "Un scan est déjà en file ou en cours pour ce site.";
      case "scan-rate-limited":
        return "Quota de scans manuels atteint. Réessayez un peu plus tard.";
    }
  }

  return "Impossible de lancer le scan pour le moment.";
}

async function runManualScanAction(
  organizationId: string,
  siteId: string,
  mode: "standard" | "deep",
): Promise<ManualScanActionState> {
  if (
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success ||
    !SiteReadSchema.shape.id.safeParse(siteId).success
  ) {
    return {
      ...initialManualScanActionState,
      error: "Site invalide.",
    };
  }

  const session = await requireCurrentSession();

  let scan;
  try {
    scan =
      mode === "deep"
        ? await createDeepScanForSite(session.user.id, organizationId, siteId)
        : await createManualScanForSite(
            session.user.id,
            organizationId,
            siteId,
          );
  } catch (error) {
    return {
      ...initialManualScanActionState,
      error: humanScanError(error),
    };
  }

  revalidatePath(`/organizations/${organizationId}`);
  revalidatePath(`/organizations/${organizationId}/sites/${siteId}`);
  redirect(`/organizations/${organizationId}/sites/${siteId}/scans/${scan.id}`);
}

export async function startManualScanAction(
  organizationId: string,
  siteId: string,
  _previousState: ManualScanActionState,
  _formData: FormData,
): Promise<ManualScanActionState> {
  void _previousState;
  void _formData;
  return runManualScanAction(organizationId, siteId, "standard");
}

export async function startDeepScanAction(
  organizationId: string,
  siteId: string,
  _previousState: ManualScanActionState,
  _formData: FormData,
): Promise<ManualScanActionState> {
  void _previousState;
  void _formData;
  return runManualScanAction(organizationId, siteId, "deep");
}
