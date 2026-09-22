import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  memberships,
  organizations,
  siteVerificationChallenges,
  sites,
  users,
} from "@agency-saas/db";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../database";
import { OrganizationAccessError } from "../organization-site-service";
import {
  createSiteVerificationChallenge,
  SiteVerificationError,
  verifySiteDnsChallenge,
} from "../site-verification";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

async function createFixture() {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const organizationId = randomUUID();
  const siteId = randomUUID();

  await db.insert(users).values([
    {
      id: ownerId,
      email: `verify-owner-${ownerId}@example.invalid`,
      displayName: "Verify Owner",
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

  return { ownerId, memberId, organizationId, siteId };
}

async function cleanupFixture(organizationId: string, userIds: string[]) {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(inArray(users.id, userIds));
}

describeDatabase("site DNS verification", () => {
  it("stores only a hash and activates the site when DNS matches", async () => {
    const fixture = await createFixture();

    try {
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

      const remainingChallenges = await db
        .select({ id: siteVerificationChallenges.id })
        .from(siteVerificationChallenges)
        .where(eq(siteVerificationChallenges.siteId, fixture.siteId));

      expect(remainingChallenges).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture.organizationId, [
        fixture.ownerId,
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
        fixture.memberId,
      ]);
    }
  });
});
