import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  organizations,
  memberships,
  scans,
  sites,
  thirdPartyObservations,
  thirdPartySnapshots,
  users,
} from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { db } from "../database";
import {
  decideThirdParty,
  getThirdPartyOverview,
} from "../third-party-service";
import { fetchStackLegalProvider } from "../stacklegal";

vi.mock("server-only", () => ({}));
vi.mock("../stacklegal", () => ({
  isStackLegalProviderId: (value: unknown) => value === "cloudflare",
  fetchStackLegalProvider: vi.fn(),
}));

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const provider = {
  id: "cloudflare" as const,
  name: "Cloudflare",
  legalName: "Cloudflare Inc.",
  category: "cdn",
  purpose: "CDN",
  location: "US",
  transfer: ["eu-us-dpf"],
  dpfStatus: "actif",
  officialUrl: "https://example.com/dpa",
  officialUrlKind: "dpa",
  pageUrl: "https://stacklegal.eu/rgpd/cloudflare",
  lastVerified: "2026-10-04",
  verification: "verified" as const,
  missing: [],
  aliases: [],
};

describeDatabase("third-party decisions and snapshots", () => {
  it("isolates organizations and sites, preserves decisions across scans and snapshots across changes", async () => {
    const [owner, member, foreign] = [randomUUID(), randomUUID(), randomUUID()];
    const [org, otherOrg] = [randomUUID(), randomUUID()];
    const [site, sibling, foreignSite] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const [scan, nextScan] = [randomUUID(), randomUUID()];
    vi.mocked(fetchStackLegalProvider).mockResolvedValue(provider);
    try {
      await db.insert(users).values([
        {
          id: owner,
          email: `third-party-${owner}@example.invalid`,
          displayName: "Owner",
        },
        {
          id: member,
          email: `third-party-${member}@example.invalid`,
          displayName: "Member",
        },
        {
          id: foreign,
          email: `third-party-${foreign}@example.invalid`,
          displayName: "Foreign",
        },
      ]);
      await db.insert(organizations).values([
        { id: org, name: "First" },
        { id: otherOrg, name: "Second" },
      ]);
      await db.insert(memberships).values([
        { userId: owner, organizationId: org, role: "owner" },
        { userId: member, organizationId: org, role: "member" },
        { userId: foreign, organizationId: otherOrg, role: "owner" },
      ]);
      await db.insert(sites).values([
        {
          id: site,
          organizationId: org,
          name: "Site",
          canonicalUrl: "https://third-party-one.example.test",
        },
        {
          id: sibling,
          organizationId: org,
          name: "Sibling",
          canonicalUrl: "https://third-party-two.example.test",
        },
        {
          id: foreignSite,
          organizationId: otherOrg,
          name: "Foreign",
          canonicalUrl: "https://third-party-three.example.test",
        },
      ]);
      await db.insert(scans).values({
        id: scan,
        organizationId: org,
        siteId: site,
        trigger: "manual",
        status: "completed",
        scanMode: "public_audit",
        completedAt: new Date("2026-01-01"),
      });
      await db.insert(thirdPartyObservations).values({
        organizationId: org,
        siteId: site,
        scanId: scan,
        providerId: "cloudflare",
        confidence: "high",
        evidence: ["Header CF-Ray observé"],
      });

      expect((await getThirdPartyOverview(owner, org, site))[0]?.status).toBe(
        "pending",
      );
      await expect(
        decideThirdParty(member, org, site, "cloudflare", "confirmed"),
      ).rejects.toThrow();
      await expect(
        decideThirdParty(foreign, otherOrg, site, "cloudflare", "confirmed"),
      ).rejects.toThrow();
      await expect(
        decideThirdParty(owner, org, sibling, "cloudflare", "confirmed"),
      ).rejects.toThrow();

      await decideThirdParty(owner, org, site, "cloudflare", "confirmed");
      expect(
        (await getThirdPartyOverview(owner, org, site))[0]?.provider?.name,
      ).toBe("Cloudflare");
      expect(await getThirdPartyOverview(owner, org, sibling)).toEqual([]);
      await decideThirdParty(owner, org, site, "cloudflare", "ignored");
      expect((await getThirdPartyOverview(owner, org, site))[0]?.status).toBe(
        "ignored",
      );

      vi.mocked(fetchStackLegalProvider).mockResolvedValueOnce(null);
      await decideThirdParty(owner, org, site, "cloudflare", "confirmed");
      expect(
        (await getThirdPartyOverview(owner, org, site))[0]?.provider,
      ).toBeNull();
      await decideThirdParty(owner, org, site, "cloudflare", "confirmed");
      await db.insert(scans).values({
        id: nextScan,
        organizationId: org,
        siteId: site,
        trigger: "manual",
        status: "completed",
        scanMode: "public_audit",
        completedAt: new Date("2026-02-01"),
      });
      const latest = await getThirdPartyOverview(owner, org, site);
      expect(latest[0]?.status).toBe("confirmed");
      expect(latest[0]?.confidence).toBeNull();
      const snapshots = await db
        .select()
        .from(thirdPartySnapshots)
        .where(
          and(
            eq(thirdPartySnapshots.organizationId, org),
            eq(thirdPartySnapshots.siteId, site),
          ),
        );
      expect(snapshots).toHaveLength(2);
    } finally {
      await db.delete(organizations).where(eq(organizations.id, org));
      await db.delete(organizations).where(eq(organizations.id, otherOrg));
      await db.delete(users).where(eq(users.id, owner));
      await db.delete(users).where(eq(users.id, member));
      await db.delete(users).where(eq(users.id, foreign));
    }
  });
});
