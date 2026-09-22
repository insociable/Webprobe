"use server";

import {
  OrganizationReadSchema,
  SiteReadSchema,
  WeeklyScanScheduleInputSchema,
} from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import {
  ScanScheduleError,
  setWeeklyScanScheduleForSite,
} from "@/lib/scan-schedule";
import { OrganizationAccessError } from "@/lib/organization-site-service";

export type ScanScheduleActionState = {
  error: string | null;
  message: string | null;
};

const initialScanScheduleActionState: ScanScheduleActionState = {
  error: null,
  message: null,
};

function minuteOfDay(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function humanScheduleError(error: unknown): string {
  if (error instanceof OrganizationAccessError) {
    return "Vous n’êtes pas autorisé à modifier cette planification.";
  }

  if (error instanceof ScanScheduleError) {
    switch (error.code) {
      case "site-not-found":
        return "Site introuvable.";
      case "site-not-active":
        return "Le domaine doit être vérifié et actif avant d’activer la planification.";
    }
  }

  return "Impossible d’enregistrer la planification pour le moment.";
}

export async function updateScanScheduleAction(
  organizationId: string,
  siteId: string,
  _previousState: ScanScheduleActionState,
  formData: FormData,
): Promise<ScanScheduleActionState> {
  void _previousState;

  if (
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success ||
    !SiteReadSchema.shape.id.safeParse(siteId).success
  ) {
    return { ...initialScanScheduleActionState, error: "Site invalide." };
  }

  const parsed = WeeklyScanScheduleInputSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    dayOfWeek: Number(formData.get("dayOfWeek")),
    minuteOfDay: minuteOfDay(formData.get("time")),
    timeZone: formData.get("timeZone"),
  });

  if (!parsed.success) {
    return {
      ...initialScanScheduleActionState,
      error: "Vérifiez le jour, l’heure et le fuseau horaire.",
    };
  }

  const session = await requireCurrentSession();

  try {
    await setWeeklyScanScheduleForSite(
      session.user.id,
      organizationId,
      siteId,
      parsed.data,
    );
  } catch (error) {
    return {
      ...initialScanScheduleActionState,
      error: humanScheduleError(error),
    };
  }

  revalidatePath(`/organizations/${organizationId}/sites/${siteId}`);

  return {
    error: null,
    message: parsed.data.enabled
      ? "Planification hebdomadaire enregistrée."
      : "Planification hebdomadaire désactivée.",
  };
}
