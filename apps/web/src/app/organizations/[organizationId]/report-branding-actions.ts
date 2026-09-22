"use server";

import {
  OrganizationReadSchema,
  ReportBrandingInputSchema,
} from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { updateReportBranding } from "@/lib/report-branding";

export type ReportBrandingActionState = {
  error: string | null;
  message: string | null;
};

export const initialReportBrandingActionState: ReportBrandingActionState = {
  error: null,
  message: null,
};

export async function updateReportBrandingAction(
  organizationId: string,
  _previousState: ReportBrandingActionState,
  formData: FormData,
): Promise<ReportBrandingActionState> {
  void _previousState;

  if (!OrganizationReadSchema.shape.id.safeParse(organizationId).success) {
    return { error: "Organisation invalide.", message: null };
  }

  const parsed = ReportBrandingInputSchema.safeParse({
    brandName: formData.get("brandName"),
    accentColor: formData.get("accentColor"),
  });
  if (!parsed.success) {
    return {
      error: "Nom de marque ou couleur invalide.",
      message: null,
    };
  }

  const session = await requireCurrentSession();
  try {
    await updateReportBranding(session.user.id, organizationId, parsed.data);
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      return {
        error: "Vous n’êtes pas autorisé à modifier le branding.",
        message: null,
      };
    }
    return {
      error: "Impossible d’enregistrer le branding pour le moment.",
      message: null,
    };
  }

  revalidatePath("/organizations/" + organizationId);
  return { error: null, message: "Branding des rapports enregistré." };
}
