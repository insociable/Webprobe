"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import {
  followupStatuses,
  updateFindingFollowup,
  type FollowupStatus,
} from "@/lib/finding-followup";

export async function updateFindingFollowupAction(
  organizationId: string,
  siteId: string,
  scanId: string,
  fingerprint: string,
  _state: { error: string | null; saved: boolean },
  formData: FormData,
): Promise<{ error: string | null; saved: boolean }> {
  try {
    const session = await requireCurrentSession();
    const status = formData.get("status");
    if (
      typeof status !== "string" ||
      !followupStatuses.includes(status as FollowupStatus)
    ) {
      throw new Error("Statut invalide.");
    }
    const assignee = formData.get("assignee");
    const due = formData.get("due");
    const note = formData.get("note");
    await updateFindingFollowup({
      userId: session.user.id,
      organizationId,
      siteId,
      scanId,
      fingerprint,
      status: status as FollowupStatus,
      assigneeUserId:
        typeof assignee === "string" && assignee ? assignee : null,
      dueAt:
        typeof due === "string" && due
          ? new Date(`${due}T00:00:00.000Z`)
          : null,
      note: typeof note === "string" ? note : null,
    });
    revalidatePath(
      `/organizations/${organizationId}/sites/${siteId}/scans/${scanId}`,
    );
    revalidatePath("/sites");
    return { error: null, saved: true };
  } catch (error) {
    return {
      error:
        error instanceof Error &&
        /^(Une justification|Statut invalide|Échéance invalide|Responsable hors)/.test(
          error.message,
        )
          ? error.message
          : "Mise à jour impossible. Vérifiez vos droits et réessayez.",
      saved: false,
    };
  }
}
