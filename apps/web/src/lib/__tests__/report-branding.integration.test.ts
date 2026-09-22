import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { memberships, organizations, users } from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { db } from "../database";
import { OrganizationAccessError } from "../organization-site-service";
import { updateReportBranding } from "../report-branding";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("report branding permissions", () => {
  it("allows owners to update branding and rejects ordinary members", async () => {
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const organizationId = randomUUID();

    try {
      await db.insert(users).values([
        {
          id: ownerId,
          email: "brand-owner-" + ownerId + "@example.invalid",
          displayName: "Brand owner",
        },
        {
          id: memberId,
          email: "brand-member-" + memberId + "@example.invalid",
          displayName: "Brand member",
        },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        name: "Brand organization",
      });
      await db.insert(memberships).values([
        { organizationId, userId: ownerId, role: "owner" },
        { organizationId, userId: memberId, role: "member" },
      ]);

      await expect(
        updateReportBranding(ownerId, organizationId, {
          brandName: "North Studio",
          accentColor: "#abcdef",
        }),
      ).resolves.toEqual({
        reportBrandName: "North Studio",
        reportAccentColor: "#abcdef",
      });

      await expect(
        updateReportBranding(memberId, organizationId, {
          brandName: "Hijacked",
          accentColor: "#000000",
        }),
      ).rejects.toBeInstanceOf(OrganizationAccessError);

      const [organization] = await db
        .select({
          reportBrandName: organizations.reportBrandName,
          reportAccentColor: organizations.reportAccentColor,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId));

      expect(organization).toEqual({
        reportBrandName: "North Studio",
        reportAccentColor: "#abcdef",
      });
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await db.delete(users).where(eq(users.id, ownerId));
      await db.delete(users).where(eq(users.id, memberId));
    }
  });
});
