"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import { parseDisplayName, updateUserDisplayName } from "@/lib/user-profile";

export type DisplayNameActionState = {
  error: string | null;
  message: string | null;
};

export async function updateDisplayNameAction(
  _previousState: DisplayNameActionState,
  formData: FormData,
): Promise<DisplayNameActionState> {
  const session = await requireCurrentSession();
  const displayName = parseDisplayName(formData.get("displayName"));

  if (!displayName) {
    return {
      error: "Le nom affiché doit contenir entre 2 et 80 caractères.",
      message: null,
    };
  }

  await updateUserDisplayName(session.user.id, displayName);
  revalidatePath("/dashboard");

  return { error: null, message: "Nom affiché mis à jour." };
}
