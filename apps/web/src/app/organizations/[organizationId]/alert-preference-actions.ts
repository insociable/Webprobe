"use server";

import {
  OrganizationReadSchema,
  ScanAlertPreferenceInputSchema,
} from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { setScanAlertPreferences } from "@/lib/scan-alert-preferences";

export type ScanAlertPreferenceActionState = {
  error: string | null;
  message: string | null;
};

const initialScanAlertPreferenceActionState: ScanAlertPreferenceActionState = {
  error: null,
  message: null,
};

export async function updateScanAlertPreferencesAction(
  organizationId: string,
  _previousState: ScanAlertPreferenceActionState,
  formData: FormData,
): Promise<ScanAlertPreferenceActionState> {
  void _previousState;

  if (!OrganizationReadSchema.shape.id.safeParse(organizationId).success) {
    return {
      ...initialScanAlertPreferenceActionState,
      error: "Organisation invalide.",
    };
  }

  const parsed = ScanAlertPreferenceInputSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    minimumSeverity: formData.get("minimumSeverity"),
  });

  if (!parsed.success) {
    return {
      ...initialScanAlertPreferenceActionState,
      error: "Niveau d’alerte invalide.",
    };
  }

  const session = await requireCurrentSession();

  try {
    await setScanAlertPreferences(session.user.id, organizationId, parsed.data);
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      return {
        ...initialScanAlertPreferenceActionState,
        error: "Vous n’êtes pas autorisé à modifier ces alertes.",
      };
    }

    return {
      ...initialScanAlertPreferenceActionState,
      error: "Impossible d’enregistrer les préférences pour le moment.",
    };
  }

  revalidatePath(`/organizations/${organizationId}`);

  return {
    error: null,
    message: parsed.data.enabled
      ? "Préférences d’alertes enregistrées."
      : "Alertes e-mail désactivées pour cette organisation.",
  };
}
