"use server";

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

  const internalOrganization = { name: "Portail principal" };

  try {
    await createInitialOrganizationForUser(
      session.user.id,
      internalOrganization,
      {
        displayName,
      },
    );
  } catch (error) {
    if (error instanceof AlreadyOnboardedError) {
      redirect("/dashboard");
    }

    console.error("Initial portal creation failed");
    return { error: "Impossible de finaliser le compte pour le moment." };
  }

  redirect("/dashboard");
}
