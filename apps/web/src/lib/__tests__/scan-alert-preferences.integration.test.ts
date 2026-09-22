import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("scan alert preferences", () => {
  it("updates only the current owner/admin membership and rejects members", async () => {
    const { memberships, organizations, users } = await import(
      "@agency-saas/db"
    );
    const { and, eq, inArray } = await import("drizzle-orm");
    const { db } = await import("../database");
    const { OrganizationAccessError } = await import(
      "../organization-site-service"
    );
    const { setScanAlertPreferences } = await import(
      "../scan-alert-preferences"
    );

    const ownerId = randomUUID();
    const adminId = randomUUID();
    const memberId = randomUUID();
    const otherOwnerId = randomUUID();
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const userIds = [ownerId, adminId, memberId, otherOwnerId];

    try {
      await db.insert(users).values([
        {
          id: ownerId,
          email: "pref-owner-" + ownerId + "@example.invalid",
          displayName: "Preference Owner",
        },
        {
          id: adminId,
          email: "pref-admin-" + adminId + "@example.invalid",
          displayName: "Preference Admin",
        },
        {
          id: memberId,
          email: "pref-member-" + memberId + "@example.invalid",
          displayName: "Preference Member",
        },
        {
          id: otherOwnerId,
          email: "pref-other-" + otherOwnerId + "@example.invalid",
          displayName: "Preference Other",
        },
      ]);
      await db.insert(organizations).values([
        { id: organizationId, name: "Preference Agency" },
        { id: otherOrganizationId, name: "Other Preference Agency" },
      ]);
      await db.insert(memberships).values([
        { organizationId, userId: ownerId, role: "owner" },
        { organizationId, userId: adminId, role: "admin" },
        { organizationId, userId: memberId, role: "member" },
        {
          organizationId: otherOrganizationId,
          userId: otherOwnerId,
          role: "owner",
        },
      ]);

      await expect(
        setScanAlertPreferences(ownerId, organizationId, {
          enabled: false,
          minimumSeverity: "critical",
        }),
      ).resolves.toEqual({
        enabled: false,
        minimumSeverity: "critical",
      });

      const rows = await db
        .select({
          userId: memberships.userId,
          enabled: memberships.scanAlertEnabled,
          minimumSeverity: memberships.scanAlertMinimumSeverity,
        })
        .from(memberships)
        .where(eq(memberships.organizationId, organizationId));

      expect(rows.find((row) => row.userId === ownerId)).toMatchObject({
        enabled: false,
        minimumSeverity: "critical",
      });
      expect(rows.find((row) => row.userId === adminId)).toMatchObject({
        enabled: true,
        minimumSeverity: "medium",
      });

      await expect(
        setScanAlertPreferences(memberId, organizationId, {
          enabled: true,
          minimumSeverity: "high",
        }),
      ).rejects.toBeInstanceOf(OrganizationAccessError);

      await expect(
        setScanAlertPreferences(ownerId, otherOrganizationId, {
          enabled: true,
          minimumSeverity: "high",
        }),
      ).rejects.toBeInstanceOf(OrganizationAccessError);

      const otherRows = await db
        .select({
          enabled: memberships.scanAlertEnabled,
          minimumSeverity: memberships.scanAlertMinimumSeverity,
        })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, otherOrganizationId),
            eq(memberships.userId, otherOwnerId),
          ),
        );

      expect(otherRows[0]).toMatchObject({
        enabled: true,
        minimumSeverity: "medium",
      });
    } finally {
      await db.delete(users).where(inArray(users.id, userIds));
      await db
        .delete(organizations)
        .where(
          inArray(organizations.id, [organizationId, otherOrganizationId]),
        );
    }
  });
});
