import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deepAuditAuthorizations,
  deepAuditChallenges,
  memberships,
  organizations,
  scanAttempts,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { eq, inArray } from "drizzle-orm";
import { db } from "../database";
import {
  issueDeepAuditChallenge,
  revokeDeepAuditGrant,
  verifyDeepAuditChallenge,
} from "../deep-audit-grants";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

async function fixture() {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  await db.insert(users).values([
    {
      id: ownerId,
      email: `deep-owner-${ownerId}@example.invalid`,
      displayName: "Deep Owner",
    },
    {
      id: memberId,
      email: `deep-member-${memberId}@example.invalid`,
      displayName: "Deep Member",
    },
  ]);
  await db
    .insert(organizations)
    .values({ id: organizationId, name: "Deep grant fixture" });
  await db.insert(memberships).values([
    { organizationId, userId: ownerId, role: "owner" },
    { organizationId, userId: memberId, role: "member" },
  ]);
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Deep site",
    canonicalUrl: "https://deep.example.test/",
    status: "active",
    verifiedAt: new Date(),
  });
  return {
    ownerId,
    memberId,
    organizationId,
    siteId,
    async cleanup() {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await db.delete(users).where(inArray(users.id, [ownerId, memberId]));
    },
  };
}

describeDatabase("Deep grant lifecycle on PostgreSQL", () => {
  it("isolates tenants and roles, stores only hashes, rotates and revokes", async () => {
    const f = await fixture();
    const input = {
      userId: f.ownerId,
      organizationId: f.organizationId,
      siteId: f.siteId,
    };
    try {
      await expect(
        issueDeepAuditChallenge({ ...input, userId: f.memberId }),
      ).rejects.toThrow("owners and admins");
      await expect(
        issueDeepAuditChallenge({ ...input, organizationId: randomUUID() }),
      ).rejects.toThrow();
      const first = await issueDeepAuditChallenge(input);
      const [stored] = await db
        .select()
        .from(deepAuditChallenges)
        .where(eq(deepAuditChallenges.siteId, f.siteId));
      expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(first.token);
      await expect(
        verifyDeepAuditChallenge(input, async () => [["wrong"]]),
      ).rejects.toThrow("proof");
      const verified = await verifyDeepAuditChallenge(input, async () => [
        [first.token],
      ]);
      const [grant] = await db
        .select()
        .from(deepAuditAuthorizations)
        .where(eq(deepAuditAuthorizations.siteId, f.siteId));
      expect(grant?.generationId).toBe(verified.generationId);
      expect(grant?.revokedAt).toBeNull();
      expect(grant?.proofTokenHash).toBe(stored?.tokenHash);
      const scanId = randomUUID();
      await db.insert(scans).values({
        id: scanId,
        siteId: f.siteId,
        organizationId: f.organizationId,
        trigger: "manual",
        status: "running",
        scanMode: "verified_deep_audit",
      });
      const [attempt] = await db
        .insert(scanAttempts)
        .values({
          scanId,
          attemptNumber: 1,
          status: "running",
          leaseToken: randomUUID(),
          leaseUntil: new Date(Date.now() + 60_000),
        })
        .returning();
      const second = await issueDeepAuditChallenge(input);
      expect(second.token).not.toBe(first.token);
      const [revoked] = await db
        .select()
        .from(deepAuditAuthorizations)
        .where(eq(deepAuditAuthorizations.siteId, f.siteId));
      expect(revoked?.revokedAt).not.toBeNull();
      const [fenced] = await db
        .select()
        .from(scanAttempts)
        .where(eq(scanAttempts.id, attempt!.id));
      expect(fenced!.leaseUntil!.getTime()).toBeLessThanOrEqual(Date.now());
      await expect(
        verifyDeepAuditChallenge(input, async () => [[first.token]]),
      ).rejects.toThrow("proof");
      await verifyDeepAuditChallenge(input, async () => [[second.token]]);
      await revokeDeepAuditGrant(input);
      const [final] = await db
        .select()
        .from(deepAuditAuthorizations)
        .where(eq(deepAuditAuthorizations.siteId, f.siteId));
      expect(final?.revokedAt).not.toBeNull();
      expect(
        await db
          .select()
          .from(deepAuditChallenges)
          .where(eq(deepAuditChallenges.siteId, f.siteId)),
      ).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it("rejects a challenge rotated, revoked or site-paused during DNS", async () => {
    for (const change of ["rotate", "revoke", "pause"] as const) {
      const f = await fixture();
      const input = {
        userId: f.ownerId,
        organizationId: f.organizationId,
        siteId: f.siteId,
      };
      try {
        const first = await issueDeepAuditChallenge(input);
        await expect(
          verifyDeepAuditChallenge(input, async () => {
            if (change === "rotate") await issueDeepAuditChallenge(input);
            if (change === "revoke") await revokeDeepAuditGrant(input);
            if (change === "pause")
              await db
                .update(sites)
                .set({ status: "paused" })
                .where(eq(sites.id, f.siteId));
            return [[first.token]];
          }),
        ).rejects.toThrow();
        const [grant] = await db
          .select()
          .from(deepAuditAuthorizations)
          .where(eq(deepAuditAuthorizations.siteId, f.siteId));
        expect(grant && !grant.revokedAt).toBeFalsy();
      } finally {
        await f.cleanup();
      }
    }
  });
});
