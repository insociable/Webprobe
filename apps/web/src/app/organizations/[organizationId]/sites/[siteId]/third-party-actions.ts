"use server";

import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import {
  decideThirdParty,
  resetThirdPartyDecision,
} from "@/lib/third-party-service";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { isStackLegalProviderId } from "@/lib/stacklegal";

export async function setThirdPartyDecisionAction(
  organizationId: string,
  siteId: string,
  formData: FormData,
): Promise<void> {
  if (
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success ||
    !SiteReadSchema.shape.id.safeParse(siteId).success
  )
    return;
  if (
    !isStackLegalProviderId(formData.get("providerId")) ||
    !["confirmed", "ignored", "reset"].includes(String(formData.get("status")))
  )
    return;
  const session = await requireCurrentSession();
  try {
    if (formData.get("status") === "reset") {
      await resetThirdPartyDecision(
        session.user.id,
        organizationId,
        siteId,
        formData.get("providerId"),
      );
    } else {
      await decideThirdParty(
        session.user.id,
        organizationId,
        siteId,
        formData.get("providerId"),
        formData.get("status"),
      );
    }
  } catch (error) {
    if (error instanceof OrganizationAccessError) return;
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/sites/${siteId}`);
}
