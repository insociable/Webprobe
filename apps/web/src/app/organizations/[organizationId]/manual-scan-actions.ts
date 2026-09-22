"use server";

import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import { createManualScanForSite, ManualScanError } from "@/lib/manual-scan";
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
      case "queue-unavailable":
        return "Le moteur de scan est temporairement indisponible.";
    }
  }

  return "Impossible de lancer le scan pour le moment.";
}

export async function startManualScanAction(
  organizationId: string,
  siteId: string,
  _previousState: ManualScanActionState,
  _formData: FormData,
): Promise<ManualScanActionState> {
  void _previousState;
  void _formData;

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

  let scan: Awaited<ReturnType<typeof createManualScanForSite>>;
  try {
    scan = await createManualScanForSite(
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
