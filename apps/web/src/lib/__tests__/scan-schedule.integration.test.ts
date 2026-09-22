import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { memberships, organizations, sites, users } from "@agency-saas/db";
import { inArray } from "drizzle-orm";
import { db } from "../database";
import {
  getWeeklyScanScheduleForSite,
  ScanScheduleError,
  setWeeklyScanScheduleForSite,
} from "../scan-schedule";
import { OrganizationAccessError } from "../organization-site-service";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("weekly scan schedule tenant and permission rules", () => {
  it("persists one scoped schedule per verified site", async () => {
    const userIds = [randomUUID(), randomUUID(), randomUUID()];
    const organizationIds = [randomUUID(), randomUUID()];
    const siteIds = [randomUUID(), randomUUID(), randomUUID()];

    try {
      await db.insert(users).values([
        {
          id: userIds[0],
          email: `schedule-owner-${userIds[0]}@example.invalid`,
          displayName: "Schedule Owner",
        },
        {
          id: userIds[1],
          email: `schedule-member-${userIds[1]}@example.invalid`,
          displayName: "Schedule Member",
        },
        {
          id: userIds[2],
          email: `schedule-other-${userIds[2]}@example.invalid`,
          displayName: "Schedule Other",
        },
      ]);

      await db.insert(organizations).values([
        { id: organizationIds[0], name: "Schedule Agency A" },
        { id: organizationIds[1], name: "Schedule Agency B" },
      ]);

      await db.insert(memberships).values([
        {
          organizationId: organizationIds[0],
          userId: userIds[0],
          role: "owner",
        },
        {
          organizationId: organizationIds[0],
          userId: userIds[1],
          role: "member",
        },
        {
          organizationId: organizationIds[1],
          userId: userIds[2],
          role: "owner",
        },
      ]);

      await db.insert(sites).values([
        {
          id: siteIds[0],
          organizationId: organizationIds[0],
          name: "Verified Site",
          canonicalUrl: "https://example.com/",
          status: "active",
          verifiedAt: new Date(),
        },
        {
          id: siteIds[1],
          organizationId: organizationIds[0],
          name: "Pending Site",
          canonicalUrl: "https://example.org/",
          status: "pending_verification",
        },
        {
          id: siteIds[2],
          organizationId: organizationIds[1],
          name: "Other Tenant Site",
          canonicalUrl: "https://example.net/",
          status: "active",
          verifiedAt: new Date(),
        },
      ]);

      const created = await setWeeklyScanScheduleForSite(
        userIds[0]!,
        organizationIds[0]!,
        siteIds[0]!,
        {
          enabled: true,
          dayOfWeek: 1,
          minuteOfDay: 540,
          timeZone: "Europe/Paris",
        },
      );

      expect(created.nextRunAt).toBeInstanceOf(Date);
      expect(created.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

      const visibleToMember = await getWeeklyScanScheduleForSite(
        userIds[1]!,
        organizationIds[0]!,
        siteIds[0]!,
      );
      expect(visibleToMember?.schedule).toMatchObject({
        id: created.id,
        enabled: true,
        dayOfWeek: 1,
        minuteOfDay: 540,
        timeZone: "Europe/Paris",
      });

      const updated = await setWeeklyScanScheduleForSite(
        userIds[0]!,
        organizationIds[0]!,
        siteIds[0]!,
        {
          enabled: true,
          dayOfWeek: 5,
          minuteOfDay: 18 * 60 + 30,
          timeZone: "Europe/Paris",
        },
      );

      expect(updated).toMatchObject({
        id: created.id,
        dayOfWeek: 5,
        minuteOfDay: 1110,
      });
      expect(updated.nextRunAt).toBeInstanceOf(Date);
      expect(updated.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

      const disabled = await setWeeklyScanScheduleForSite(
        userIds[0]!,
        organizationIds[0]!,
        siteIds[0]!,
        {
          enabled: false,
          dayOfWeek: 5,
          minuteOfDay: 1110,
          timeZone: "Europe/Paris",
        },
      );
      expect(disabled.nextRunAt).toBeNull();

      await expect(
        setWeeklyScanScheduleForSite(
          userIds[1]!,
          organizationIds[0]!,
          siteIds[0]!,
          {
            enabled: true,
            dayOfWeek: 2,
            minuteOfDay: 600,
            timeZone: "Europe/Paris",
          },
        ),
      ).rejects.toBeInstanceOf(OrganizationAccessError);

      await expect(
        setWeeklyScanScheduleForSite(
          userIds[0]!,
          organizationIds[0]!,
          siteIds[1]!,
          {
            enabled: true,
            dayOfWeek: 2,
            minuteOfDay: 600,
            timeZone: "Europe/Paris",
          },
        ),
      ).rejects.toMatchObject<Partial<ScanScheduleError>>({
        code: "site-not-active",
      });

      await expect(
        getWeeklyScanScheduleForSite(
          userIds[0]!,
          organizationIds[1]!,
          siteIds[2]!,
        ),
      ).rejects.toBeInstanceOf(OrganizationAccessError);
    } finally {
      await db.delete(users).where(inArray(users.id, userIds));
      await db
        .delete(organizations)
        .where(inArray(organizations.id, organizationIds));
    }
  });
});
