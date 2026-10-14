import { randomUUID } from "node:crypto";
import {
  deepAuditAuthorizations,
  memberships,
  organizations,
  sites,
  users,
} from "@agency-saas/db";
import {
  canonicalSiteOrigin,
  siteOwnershipRecordName,
} from "@agency-saas/security";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../database";
import {
  issueDeepAuditChallenge,
  revokeDeepAuditGrant,
} from "../deep-audit-grants";
import {
  getDeepCrawlConsent,
  grantDeepCrawlConsent,
  revokeDeepCrawlConsent,
} from "../deep-crawl-consents";

const describeDb =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const canonicalUrl = "https://deep.example.test/";

async function fixture() {
  const ownerId = randomUUID();
  const adminId = randomUUID();
  const memberId = randomUUID();
  const externalId = randomUUID();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const ownershipGeneration = randomUUID();
  const grantGeneration = randomUUID();
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const tomorrow = new Date(now.getTime() + 21_600_000);
  await db.insert(users).values(
    [ownerId, adminId, memberId, externalId].map((id) => ({
      id,
      email: "lot5b2-" + id + "@example.invalid",
      displayName: "Lot5B2 Fixture",
    })),
  );
  await db
    .insert(organizations)
    .values({ id: organizationId, name: "Lot5B2 private fixture" });
  await db.insert(memberships).values([
    { organizationId, userId: ownerId, role: "owner" },
    { organizationId, userId: adminId, role: "admin" },
    { organizationId, userId: memberId, role: "member" },
  ]);
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Fixture site",
    canonicalUrl,
    status: "active",
    verifiedAt: hourAgo,
    ownershipTokenHash: "a".repeat(64),
    ownershipRecordName: siteOwnershipRecordName(canonicalUrl),
    ownershipOrigin: canonicalSiteOrigin(canonicalUrl),
    ownershipGeneration,
    ownershipVerifiedAt: hourAgo,
    ownershipExpiresAt: tomorrow,
    ownershipRevalidatedAt: now,
  });
  await db.insert(deepAuditAuthorizations).values({
    siteId,
    proofType: "dns_txt",
    proofRecordName: siteOwnershipRecordName(canonicalUrl),
    proofTokenHash: "b".repeat(64),
    generationId: grantGeneration,
    proofVerifiedAt: hourAgo,
    revalidatedAt: now,
    expiresAt: tomorrow,
  });
  const request = { userId: ownerId, organizationId, siteId };
  return {
    request,
    ownerId,
    adminId,
    memberId,
    externalId,
    organizationId,
    siteId,
    ownershipGeneration,
    grantGeneration,
    async cleanup() {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await db
        .delete(users)
        .where(inArray(users.id, [ownerId, adminId, memberId, externalId]));
    },
  };
}

describeDb(
  "Multi-page crawl consent is opt-in, tenant-scoped and revocable",
  () => {
    it("creates nothing by default, binds both proof generations, updates revision and revokes", async () => {
      const f = await fixture();
      try {
        expect(await getDeepCrawlConsent(f.request)).toBeNull();
        const created = await grantDeepCrawlConsent({
          ...f.request,
          maxPages: 3,
          allowedPathPrefixes: ["/blog/", "/about"],
        });
        expect(created).toMatchObject({
          siteId: f.siteId,
          organizationId: f.organizationId,
          maxPages: 3,
          ownershipGeneration: f.ownershipGeneration,
          deepGenerationId: f.grantGeneration,
          allowedPathPrefixes: ["/blog/", "/about"],
          revision: 1,
          revokedAt: null,
        });
        expect(
          created.expiresAt.getTime() - created.grantedAt.getTime(),
        ).toBeLessThanOrEqual(86_400_000);
        expect(created.grantedBy).toBe(f.ownerId);
        const updated = await grantDeepCrawlConsent({
          ...f.request,
          maxPages: 2,
          allowedPathPrefixes: ["/docs/"],
        });
        expect(updated).toMatchObject({
          maxPages: 2,
          allowedPathPrefixes: ["/docs/"],
          revision: 2,
          revokedAt: null,
        });
        expect((await revokeDeepCrawlConsent(f.request)).revoked).toBe(true);
        const revoked = await getDeepCrawlConsent(f.request);
        expect(revoked?.revision).toBe(3);
        expect(revoked?.revokedAt).toBeInstanceOf(Date);
        expect((await revokeDeepCrawlConsent(f.request)).revoked).toBe(false);
        const regranted = await grantDeepCrawlConsent({
          ...f.request,
          maxPages: 2,
          allowedPathPrefixes: ["/about"],
        });
        expect(regranted.revision).toBe(4);
        expect(regranted.revokedAt).toBeNull();
      } finally {
        await f.cleanup();
      }
    });

    it("blocks members, strangers, foreign tenants and unsafe paths", async () => {
      const f = await fixture();
      try {
        await expect(
          grantDeepCrawlConsent({
            ...f.request,
            userId: f.memberId,
            maxPages: 2,
            allowedPathPrefixes: ["/docs/"],
          }),
        ).rejects.toThrow("owners and admins");
        await expect(
          grantDeepCrawlConsent({
            ...f.request,
            userId: f.externalId,
            maxPages: 2,
            allowedPathPrefixes: ["/docs/"],
          }),
        ).rejects.toThrow("owners and admins");
        await expect(
          grantDeepCrawlConsent({
            ...f.request,
            organizationId: randomUUID(),
            maxPages: 2,
            allowedPathPrefixes: ["/docs/"],
          }),
        ).rejects.toThrow();
        for (const allowedPathPrefixes of [
          [],
          ["/"],
          ["/logout"],
          ["/blog/?token=test"],
          ["/blog/%2fadmin"],
          ["/admin/"],
          ["/posts/", "/posts/"],
        ]) {
          await expect(
            grantDeepCrawlConsent({
              ...f.request,
              maxPages: 2,
              allowedPathPrefixes,
            }),
          ).rejects.toThrow("safe path");
        }
        await expect(
          grantDeepCrawlConsent({
            ...f.request,
            maxPages: 40,
            allowedPathPrefixes: ["/blog/"],
          }),
        ).rejects.toThrow("Page limit");
        await expect(
          revokeDeepCrawlConsent({ ...f.request, userId: f.memberId }),
        ).rejects.toThrow("owners and admins");
        await expect(
          getDeepCrawlConsent({ ...f.request, userId: f.externalId }),
        ).rejects.toThrow("membership");
        const byAdmin = await grantDeepCrawlConsent({
          ...f.request,
          userId: f.adminId,
          maxPages: 2,
          allowedPathPrefixes: ["/docs/"],
        });
        expect(byAdmin.grantedBy).toBe(f.adminId);
      } finally {
        await f.cleanup();
      }
    });

    it("fails closed on missing, stale, revoked or rotated Deep DNS grant", async () => {
      const f = await fixture();
      try {
        await db
          .update(deepAuditAuthorizations)
          .set({ revalidatedAt: new Date(Date.now() - 600_000) })
          .where(eq(deepAuditAuthorizations.siteId, f.siteId));
        await expect(
          grantDeepCrawlConsent({
            ...f.request,
            maxPages: 2,
            allowedPathPrefixes: ["/docs/"],
          }),
        ).rejects.toThrow("Deep DNS grant");
        await db
          .update(deepAuditAuthorizations)
          .set({ revalidatedAt: new Date(), revokedAt: new Date() })
          .where(eq(deepAuditAuthorizations.siteId, f.siteId));
        await expect(
          grantDeepCrawlConsent({
            ...f.request,
            maxPages: 2,
            allowedPathPrefixes: ["/docs/"],
          }),
        ).rejects.toThrow("Deep DNS grant");
        await db
          .update(deepAuditAuthorizations)
          .set({
            revokedAt: null,
            revalidatedAt: new Date(),
            generationId: randomUUID(),
          })
          .where(eq(deepAuditAuthorizations.siteId, f.siteId));
        const newlyGranted = await grantDeepCrawlConsent({
          ...f.request,
          maxPages: 2,
          allowedPathPrefixes: ["/docs/"],
        });
        expect(newlyGranted.deepGenerationId).not.toBe(f.grantGeneration);
        await db
          .update(sites)
          .set({ ownershipGeneration: randomUUID() })
          .where(eq(sites.id, f.siteId));
        const reissued = await grantDeepCrawlConsent({
          ...f.request,
          maxPages: 2,
          allowedPathPrefixes: ["/blog/"],
        });
        expect(reissued.ownershipGeneration).not.toBe(f.ownershipGeneration);
      } finally {
        await f.cleanup();
      }
    });

    it("revokes crawl consent transactionally when a Deep grant rotates or is revoked", async () => {
      const f = await fixture();
      try {
        const first = await grantDeepCrawlConsent({
          ...f.request,
          maxPages: 2,
          allowedPathPrefixes: ["/docs/"],
        });
        expect(first.revokedAt).toBeNull();
        await issueDeepAuditChallenge(f.request);
        const rotated = await getDeepCrawlConsent(f.request);
        expect(rotated?.revokedAt).toBeInstanceOf(Date);
        expect(rotated?.revision).toBe(2);
        await db
          .update(deepAuditAuthorizations)
          .set({ revokedAt: null, revalidatedAt: new Date() })
          .where(eq(deepAuditAuthorizations.siteId, f.siteId));
        await grantDeepCrawlConsent({
          ...f.request,
          maxPages: 2,
          allowedPathPrefixes: ["/docs/"],
        });
        await revokeDeepAuditGrant(f.request);
        const revoked = await getDeepCrawlConsent(f.request);
        expect(revoked?.revokedAt).toBeInstanceOf(Date);
        expect(revoked?.revision).toBe(4);
      } finally {
        await f.cleanup();
      }
    });

    it("refuses site proof without recent revalidation; revocation still works if paused", async () => {
      const f = await fixture();
      try {
        await db
          .update(sites)
          .set({ ownershipRevalidatedAt: new Date(Date.now() - 600_000) })
          .where(eq(sites.id, f.siteId));
        await expect(
          grantDeepCrawlConsent({
            ...f.request,
            maxPages: 2,
            allowedPathPrefixes: ["/blog/"],
          }),
        ).rejects.toThrow("site DNS ownership");
        await db
          .update(sites)
          .set({ ownershipRevalidatedAt: new Date() })
          .where(eq(sites.id, f.siteId));
        await grantDeepCrawlConsent({
          ...f.request,
          maxPages: 2,
          allowedPathPrefixes: ["/blog/"],
        });
        await db
          .update(sites)
          .set({ status: "paused" })
          .where(eq(sites.id, f.siteId));
        expect((await revokeDeepCrawlConsent(f.request)).revoked).toBe(true);
        await expect(
          grantDeepCrawlConsent({
            ...f.request,
            maxPages: 2,
            allowedPathPrefixes: ["/blog/"],
          }),
        ).rejects.toThrow("site DNS ownership");
      } finally {
        await f.cleanup();
      }
    });
  },
);
