import {
  ScanAlertPreferenceInputSchema,
  type ScanAlertPreferenceInput,
} from "@agency-saas/contracts";
import { memberships } from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { db } from "./database";
import {
  OrganizationAccessError,
  canManageOrganization,
  requireOrganizationAccess,
} from "./organization-site-service";

export async function setScanAlertPreferences(
  userId: string,
  organizationId: string,
  input: ScanAlertPreferenceInput,
) {
  const access = await requireOrganizationAccess(userId, organizationId);

  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only organization owners and admins can configure scan alerts",
    );
  }

  const data = ScanAlertPreferenceInputSchema.parse(input);
  const [updated] = await db
    .update(memberships)
    .set({
      scanAlertEnabled: data.enabled,
      scanAlertMinimumSeverity: data.minimumSeverity,
    })
    .where(
      and(
        eq(memberships.id, access.membershipId),
        eq(memberships.userId, userId),
        eq(memberships.organizationId, organizationId),
      ),
    )
    .returning({
      enabled: memberships.scanAlertEnabled,
      minimumSeverity: memberships.scanAlertMinimumSeverity,
    });

  if (!updated) {
    throw new OrganizationAccessError();
  }

  return updated;
}
