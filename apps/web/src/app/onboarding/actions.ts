"use server";

import { OrganizationCreateSchema } from "@agency-saas/contracts";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import { parseDisplayName } from "@/lib/user-profile";
import {
  AlreadyOnboardedError,
  createInitialOrganizationForUser,
} from "@/lib/organization-site-service";

export type OnboardingActionState = {
  error: string | null;
};

export async function createInitialOrganizationAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const session = await requireCurrentSession();
  const displayName = parseDisplayName(formData.get("displayName"));
  if (!displayName) {
    return { error: "Le nom affiché doit contenir entre 2 et 80 caractères." };
  }

  const parsed = OrganizationCreateSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Nom d’agence invalide.",
    };
  }

  try {
    await createInitialOrganizationForUser(session.user.id, parsed.data, {
      displayName,
    });
  } catch (error) {
    if (error instanceof AlreadyOnboardedError) {
      redirect("/dashboard");
    }

    console.error("Initial organization creation failed");
    return { error: "Impossible de créer l’agence pour le moment." };
  }

  redirect("/dashboard");
}
