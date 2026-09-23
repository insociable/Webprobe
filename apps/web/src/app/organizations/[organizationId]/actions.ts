"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import {
  OrganizationAccessError,
  updateOrganizationName,
} from "@/lib/organization-site-service";

export type OrganizationNameActionState = {
  error: string | null;
  message: string | null;
};

export async function updateOrganizationNameAction(
  _previousState: OrganizationNameActionState,
  formData: FormData,
): Promise<OrganizationNameActionState> {
  const session = await requireCurrentSession();
  const organizationId = formData.get("organizationId");
  const rawName = formData.get("name");

  if (typeof organizationId !== "string" || typeof rawName !== "string") {
    return { error: "Données invalides.", message: null };
  }

  const name = rawName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) {
    return {
      error: "Le nom de l’espace doit contenir entre 2 et 120 caractères.",
      message: null,
    };
  }

  try {
    await updateOrganizationName(session.user.id, organizationId, name);
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      return {
        error: "Vous n’avez pas les droits pour renommer cet espace.",
        message: null,
      };
    }
    throw error;
  }

  revalidatePath("/dashboard");
  revalidatePath("/organizations/" + organizationId);

  return { error: null, message: "Espace renommé." };
}
