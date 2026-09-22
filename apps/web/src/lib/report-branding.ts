import {
  ReportBrandingInputSchema,
  type ReportBrandingInput,
} from "@agency-saas/contracts";
import { organizations } from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";

export async function updateReportBranding(
  userId: string,
  organizationId: string,
  input: ReportBrandingInput,
) {
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only organization owners and admins can update report branding",
    );
  }

  const data = ReportBrandingInputSchema.parse(input);
  const [organization] = await db
    .update(organizations)
    .set({
      reportBrandName: data.brandName,
      reportAccentColor: data.accentColor,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId))
    .returning({
      reportBrandName: organizations.reportBrandName,
      reportAccentColor: organizations.reportAccentColor,
    });

  if (!organization) {
    throw new OrganizationAccessError();
  }

  return organization;
}
