import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("organization/site tenant isolation", () => {
  it("scopes reads and mutations to explicit memberships", async () => {
    const { organizations, memberships, users } = await import(
      "@agency-saas/db"
    );
    const { inArray } = await import("drizzle-orm");
    const { db } = await import("../database");
    const {
      createSiteForOrganization,
      getOrganizationAccess,
      getSiteForOrganization,
      listSitesForOrganization,
      updateOrganizationName,
      OrganizationAccessError,
    } = await import("../organization-site-service");

    const userIds = [randomUUID(), randomUUID(), randomUUID()];
    const organizationIds = [randomUUID(), randomUUID()];

    try {
      await db.insert(users).values([
        {
          id: userIds[0],
          email: `owner-a-${userIds[0]}@example.invalid`,
          displayName: "Owner A",
        },
        {
          id: userIds[1],
          email: `owner-b-${userIds[1]}@example.invalid`,
          displayName: "Owner B",
        },
        {
          id: userIds[2],
          email: `member-a-${userIds[2]}@example.invalid`,
          displayName: "Member A",
        },
      ]);
      await db.insert(organizations).values([
        { id: organizationIds[0], name: "Agency A" },
        { id: organizationIds[1], name: "Agency B" },
      ]);

      await db.insert(memberships).values([
        {
          organizationId: organizationIds[0],
          userId: userIds[0],
          role: "owner",
        },
        {
          organizationId: organizationIds[1],
          userId: userIds[1],
          role: "owner",
        },
        {
          organizationId: organizationIds[0],
          userId: userIds[2],
          role: "member",
        },
      ]);

      await expect(
        getOrganizationAccess(userIds[0]!, organizationIds[0]!),
      ).resolves.toMatchObject({
        organizationId: organizationIds[0],
        role: "owner",
      });

      await expect(
        getOrganizationAccess(userIds[0]!, organizationIds[1]!),
      ).resolves.toBeNull();

      await expect(
        updateOrganizationName(
          userIds[0]!,
          organizationIds[0]!,
          "Agency A renamed",
        ),
      ).resolves.toMatchObject({ name: "Agency A renamed" });

      await expect(
        updateOrganizationName(
          userIds[2]!,
          organizationIds[0]!,
          "Forbidden rename",
        ),
      ).rejects.toBeInstanceOf(OrganizationAccessError);

      await expect(
        updateOrganizationName(
          userIds[0]!,
          organizationIds[1]!,
          "Cross tenant rename",
        ),
      ).rejects.toBeInstanceOf(OrganizationAccessError);

      const site = await createSiteForOrganization(
        userIds[0]!,
        organizationIds[0]!,
        {
          name: "Agency A site",
          canonicalUrl: "https://example.com/",
        },
      );
      await expect(
        getSiteForOrganization(userIds[0]!, organizationIds[0]!, site.id),
      ).resolves.toMatchObject({ id: site.id });

      await expect(
        getSiteForOrganization(userIds[0]!, organizationIds[1]!, site.id),
      ).rejects.toBeInstanceOf(OrganizationAccessError);

      const visibleSites = await listSitesForOrganization(
        userIds[0]!,
        organizationIds[0]!,
      );
      expect(visibleSites.map((item) => item.id)).toEqual([site.id]);

      await expect(
        createSiteForOrganization(userIds[2]!, organizationIds[0]!, {
          name: "Forbidden site",
          canonicalUrl: "https://example.org/",
        }),
      ).rejects.toBeInstanceOf(OrganizationAccessError);
    } finally {
      await db.delete(users).where(inArray(users.id, userIds));
      await db
        .delete(organizations)
        .where(inArray(organizations.id, organizationIds));
    }
  });

  it("serializes initial onboarding for the same user", async () => {
    const { memberships, organizations, users } = await import(
      "@agency-saas/db"
    );
    const { eq, inArray } = await import("drizzle-orm");
    const { db } = await import("../database");
    const { AlreadyOnboardedError, createInitialOrganizationForUser } =
      await import("../organization-site-service");

    const userId = randomUUID();
    const createdOrganizationIds: string[] = [];

    try {
      await db.insert(users).values({
        id: userId,
        email: `onboarding-${userId}@example.invalid`,
        displayName: "Onboarding User",
      });

      const results = await Promise.allSettled([
        createInitialOrganizationForUser(
          userId,
          { name: "Agency First" },
          { displayName: "Configured User" },
        ),
        createInitialOrganizationForUser(
          userId,
          { name: "Agency Second" },
          { displayName: "Configured User" },
        ),
      ]);

      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter((result) => result.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const successfulResult = fulfilled[0];
      const rejectedResult = rejected[0];
      if (successfulResult?.status !== "fulfilled") {
        throw new Error("Expected exactly one successful onboarding");
      }
      if (rejectedResult?.status !== "rejected") {
        throw new Error("Expected exactly one rejected onboarding");
      }

      expect(rejectedResult.reason).toBeInstanceOf(AlreadyOnboardedError);
      createdOrganizationIds.push(successfulResult.value.id);

      const rows = await db
        .select({ organizationId: memberships.organizationId })
        .from(memberships)
        .where(eq(memberships.userId, userId));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.organizationId).toBe(successfulResult.value.id);

      const [profile] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, userId));
      expect(profile?.displayName).toBe("Configured User");
    } finally {
      await db.delete(users).where(eq(users.id, userId));
      if (createdOrganizationIds.length > 0) {
        await db
          .delete(organizations)
          .where(inArray(organizations.id, createdOrganizationIds));
      }
    }
  });
});
