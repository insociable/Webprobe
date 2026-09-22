import {
  WeeklyScanScheduleInputSchema,
  type WeeklyScanScheduleInput,
} from "@agency-saas/contracts";
import { scanSchedules } from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  getSiteForOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";

export class ScanScheduleError extends Error {
  constructor(
    message: string,
    readonly code: "site-not-found" | "site-not-active",
  ) {
    super(message);
    this.name = "ScanScheduleError";
  }
}

export async function getWeeklyScanScheduleForSite(
  userId: string,
  organizationId: string,
  siteId: string,
) {
  const access = await requireOrganizationAccess(userId, organizationId);
  const site = await getSiteForOrganization(userId, organizationId, siteId);

  if (!site) {
    return null;
  }

  const rows = await db
    .select()
    .from(scanSchedules)
    .where(
      and(
        eq(scanSchedules.organizationId, organizationId),
        eq(scanSchedules.siteId, siteId),
      ),
    )
    .limit(1);

  return {
    access,
    site,
    schedule: rows[0] ?? null,
  };
}

export async function setWeeklyScanScheduleForSite(
  userId: string,
  organizationId: string,
  siteId: string,
  input: WeeklyScanScheduleInput,
) {
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only organization owners and admins can configure scan schedules",
    );
  }

  const site = await getSiteForOrganization(userId, organizationId, siteId);
  if (!site) {
    throw new ScanScheduleError("Site not found", "site-not-found");
  }

  const data = WeeklyScanScheduleInputSchema.parse(input);
  if (data.enabled && (site.status !== "active" || !site.verifiedAt)) {
    throw new ScanScheduleError(
      "Site must be verified and active before enabling a schedule",
      "site-not-active",
    );
  }

  const [schedule] = await db
    .insert(scanSchedules)
    .values({
      organizationId,
      siteId,
      enabled: data.enabled,
      dayOfWeek: data.dayOfWeek,
      minuteOfDay: data.minuteOfDay,
      timeZone: data.timeZone,
    })
    .onConflictDoUpdate({
      target: scanSchedules.siteId,
      set: {
        organizationId,
        enabled: data.enabled,
        dayOfWeek: data.dayOfWeek,
        minuteOfDay: data.minuteOfDay,
        timeZone: data.timeZone,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!schedule) {
    throw new Error("Scan schedule update failed");
  }

  return schedule;
}
