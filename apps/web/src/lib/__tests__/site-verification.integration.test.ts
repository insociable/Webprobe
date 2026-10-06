import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  memberships,
  organizations,
  siteVerificationChallenges,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSiteOwnershipProofTtlMs } from "@agency-saas/security";
import { db } from "../database";
import { OrganizationAccessError } from "../organization-site-service";
import {
  createSiteVerificationChallenge,
  getSiteVerificationChallengeState,
  revalidateSiteOwnershipProof,
  SiteVerificationError,
  verifySiteDnsChallenge,
} from "../site-verification";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

async function createFixture() {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const adminId = randomUUID();
  const organizationId = randomUUID();
  const siteId = randomUUID();

  await db.insert(users).values([
    {
      id: ownerId,
      email: `verify-owner-${ownerId}@example.invalid`,
      displayName: "Verify Owner",
    },
    {
      id: adminId,
      email: `verify-admin-${adminId}@example.invalid`,
      displayName: "Verify Admin",
    },
    {
      id: memberId,
      email: `verify-member-${memberId}@example.invalid`,
      displayName: "Verify Member",
    },
  ]);

  await db.insert(organizations).values({
    id: organizationId,
    name: "Verification Agency",
  });

  await db.insert(memberships).values([
    {
      organizationId,
      userId: ownerId,
      role: "owner",
    },
    { organizationId, userId: adminId, role: "admin" },
    {
      organizationId,
      userId: memberId,
      role: "member",
    },
  ]);

  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Verification Site",
    canonicalUrl: "https://example.com/",
    status: "pending_verification",
  });

  return { ownerId, adminId, memberId, organizationId, siteId };
}

async function cleanupFixture(organizationId: string, userIds: string[]) {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(inArray(users.id, userIds));
}

describeDatabase("site DNS verification", () => {
  it("stores only a hash and activates the site when DNS matches", async () => {
    const fixture = await createFixture();

    try {
      const [publicAudit] = await db
        .insert(scans)
        .values({
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          trigger: "manual",
          scanMode: "public_audit",
          requestedByUserId: fixture.ownerId,
          status: "completed",
          completedAt: new Date(),
        })
        .returning({ id: scans.id });

      const challenge = await createSiteVerificationChallenge(
        fixture.ownerId,
        fixture.organizationId,
        fixture.siteId,
      );

      expect(challenge.recordName).toBe("_agency-monitor.example.com");
      expect(challenge.token).toMatch(/^agency-monitor-verification=/);

      const stored = await db
        .select({
          tokenHash: siteVerificationChallenges.tokenHash,
          recordName: siteVerificationChallenges.recordName,
        })
        .from(siteVerificationChallenges)
        .where(
          and(
            eq(
              siteVerificationChallenges.organizationId,
              fixture.organizationId,
            ),
            eq(siteVerificationChallenges.siteId, fixture.siteId),
          ),
        )
        .limit(1);

      expect(stored[0]?.recordName).toBe(challenge.recordName);
      expect(stored[0]?.tokenHash).toHaveLength(64);
      expect(stored[0]?.tokenHash).not.toContain(challenge.token);

      const verified = await verifySiteDnsChallenge(
        fixture.ownerId,
        fixture.organizationId,
        fixture.siteId,
        async (hostname) => {
          expect(hostname).toBe(challenge.recordName);
          return [[challenge.token]];
        },
      );

      expect(verified.status).toBe("active");
      expect(verified.verifiedAt).toBeInstanceOf(Date);

      const preservedAudit = publicAudit
        ? await db
            .select({ id: scans.id, scanMode: scans.scanMode })
            .from(scans)
            .where(eq(scans.id, publicAudit.id))
            .limit(1)
        : [];
      expect(preservedAudit[0]).toEqual({
        id: publicAudit?.id,
        scanMode: "public_audit",
      });

      const remainingChallenges = await db
        .select({ id: siteVerificationChallenges.id })
        .from(siteVerificationChallenges)
        .where(eq(siteVerificationChallenges.siteId, fixture.siteId));

      expect(remainingChallenges).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.adminId,
        fixture.memberId,
      ]);
    }
  });
  it("does not let an ordinary member create a challenge", async () => {
    const fixture = await createFixture();

    try {
      await expect(
        createSiteVerificationChallenge(
          fixture.memberId,
          fixture.organizationId,
          fixture.siteId,
        ),
      ).rejects.toBeInstanceOf(OrganizationAccessError);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.adminId,
        fixture.memberId,
      ]);
    }
  });

  it("keeps the site pending when the DNS token does not match", async () => {
    const fixture = await createFixture();

    try {
      await createSiteVerificationChallenge(
        fixture.ownerId,
        fixture.organizationId,
        fixture.siteId,
      );

      await expect(
        verifySiteDnsChallenge(
          fixture.ownerId,
          fixture.organizationId,
          fixture.siteId,
          async () => [["agency-monitor-verification=wrong"]],
        ),
      ).rejects.toMatchObject({
        code: "dns-record-not-found",
      } satisfies Partial<SiteVerificationError>);

      const persisted = await db
        .select({
          status: sites.status,
          verifiedAt: sites.verifiedAt,
        })
        .from(sites)
        .where(
          and(
            eq(sites.id, fixture.siteId),
            eq(sites.organizationId, fixture.organizationId),
          ),
        )
        .limit(1);

      expect(persisted[0]).toMatchObject({
        status: "pending_verification",
        verifiedAt: null,
      });
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.adminId,
        fixture.memberId,
      ]);
    }
  });

  it("treats a missing TXT record as a verification miss", async () => {
    const fixture = await createFixture();

    try {
      await createSiteVerificationChallenge(
        fixture.ownerId,
        fixture.organizationId,
        fixture.siteId,
      );

      await expect(
        verifySiteDnsChallenge(
          fixture.ownerId,
          fixture.organizationId,
          fixture.siteId,
          async () => {
            const error = new Error("dns missing") as NodeJS.ErrnoException;
            error.code = "ENODATA";
            throw error;
          },
        ),
      ).rejects.toMatchObject({ code: "dns-record-not-found" });
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.adminId,
        fixture.memberId,
      ]);
    }
  });
  it("keeps the challenge after SERVFAIL and accepts a fragmented TXT on retry", async () => {
    const fixture = await createFixture();
    try {
      const challenge = await createSiteVerificationChallenge(
        fixture.adminId,
        fixture.organizationId,
        fixture.siteId,
      );
      await expect(
        verifySiteDnsChallenge(
          fixture.adminId,
          fixture.organizationId,
          fixture.siteId,
          async () => {
            throw Object.assign(new Error("resolver unavailable"), {
              code: "ESERVFAIL",
            });
          },
        ),
      ).rejects.toMatchObject({ code: "dns-unavailable" });
      const state = await getSiteVerificationChallengeState(
        fixture.adminId,
        fixture.organizationId,
        fixture.siteId,
      );
      expect(state.challenge).not.toBeNull();
      const verified = await verifySiteDnsChallenge(
        fixture.adminId,
        fixture.organizationId,
        fixture.siteId,
        async () => [[challenge.token.slice(0, 20), challenge.token.slice(20)]],
      );
      expect(verified.status).toBe("active");
      expect(verified.ownershipTokenHash).toHaveLength(64);
      expect(
        verified.ownershipExpiresAt!.getTime() -
          verified.ownershipVerifiedAt!.getTime(),
      ).toBe(getSiteOwnershipProofTtlMs());
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.adminId,
        fixture.memberId,
      ]);
    }
  });

  it("rejects an expired challenge even if the old TXT is still present", async () => {
    const fixture = await createFixture();
    try {
      const challenge = await createSiteVerificationChallenge(
        fixture.ownerId,
        fixture.organizationId,
        fixture.siteId,
      );
      await db
        .update(siteVerificationChallenges)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(siteVerificationChallenges.siteId, fixture.siteId));
      await expect(
        verifySiteDnsChallenge(
          fixture.ownerId,
          fixture.organizationId,
          fixture.siteId,
          async () => [[challenge.token]],
        ),
      ).rejects.toMatchObject({ code: "challenge-expired" });
      const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.id, fixture.siteId));
      expect(site?.status).toBe("pending_verification");
      expect(site?.ownershipTokenHash).toBeNull();
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.adminId,
        fixture.memberId,
      ]);
    }
  });

  it("renews an expired proof after temporary DNS failure without changing its generation", async () => {
    const fixture = await createFixture();
    try {
      const challenge = await createSiteVerificationChallenge(
        fixture.ownerId,
        fixture.organizationId,
        fixture.siteId,
      );
      const verified = await verifySiteDnsChallenge(
        fixture.ownerId,
        fixture.organizationId,
        fixture.siteId,
        async () => [[challenge.token]],
      );
      await db
        .update(sites)
        .set({
          ownershipVerifiedAt: new Date(Date.now() - 3_600_000),
          ownershipExpiresAt: new Date(Date.now() - 1_000),
        })
        .where(eq(sites.id, fixture.siteId));
      await expect(
        revalidateSiteOwnershipProof({
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          force: true,
          resolver: async () => {
            throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
          },
        }),
      ).rejects.toMatchObject({ code: "dns-unavailable" });
      const renewed = await revalidateSiteOwnershipProof({
        organizationId: fixture.organizationId,
        siteId: fixture.siteId,
        force: true,
        resolver: async () => [[challenge.token]],
      });
      expect(renewed.ownershipGeneration).toBe(verified.ownershipGeneration);
      expect(renewed.ownershipInvalidatedAt).toBeNull();
      expect(renewed.ownershipExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.adminId,
        fixture.memberId,
      ]);
    }
  });

  it("requires a new challenge for a historical verified site without a token hash", async () => {
    const fixture = await createFixture();
    try {
      await db
        .update(sites)
        .set({ status: "active", verifiedAt: new Date() })
        .where(eq(sites.id, fixture.siteId));
      const state = await getSiteVerificationChallengeState(
        fixture.ownerId,
        fixture.organizationId,
        fixture.siteId,
      );
      expect(state.ownershipState).toBe("missing");
      await expect(
        revalidateSiteOwnershipProof({
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
        }),
      ).rejects.toMatchObject({ code: "ownership-reverification-required" });
      const challenge = await createSiteVerificationChallenge(
        fixture.adminId,
        fixture.organizationId,
        fixture.siteId,
      );
      expect(challenge.token).toMatch(/^agency-monitor-verification=/);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
        fixture.adminId,
        fixture.memberId,
      ]);
    }
  });
});
