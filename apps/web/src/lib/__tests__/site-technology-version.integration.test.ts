import { randomInt, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  memberships,
  organizations,
  scans,
  sites,
  siteTechnologyVersions,
  siteVulnerabilityMatches,
  technologyObservations,
  users,
  vulnerabilityAdvisories,
  vulnerabilityAffectedProducts,
} from "@agency-saas/db";
import { eq, inArray } from "drizzle-orm";
import { db } from "../database";
import { OrganizationAccessError } from "../organization-site-service";
import {
  setSiteTechnologyVersion,
  TechnologyVersionError,
} from "../site-technology-version";
import {
  getOrganizationVulnerabilitySummary,
  getScanVulnerabilityOverview,
  getSiteVulnerabilityOverview,
} from "../vulnerability-intelligence";
import { setSiteVulnerabilityReview } from "../vulnerability-review";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("CVE batch version declarations", () => {
  it("compares a whole technology, isolates tenants and keeps scan history intact", async () => {
    const userIds = [randomUUID(), randomUUID(), randomUUID()];
    const orgIds = [randomUUID(), randomUUID()];
    const siteIds = [randomUUID(), randomUUID()];
    const scanIds = [randomUUID(), randomUUID(), randomUUID()];
    const cveIds = Array.from(
      { length: 4 },
      () => `CVE-2099-${randomInt(100000000, 999999999)}`,
    );
    try {
      await db.insert(users).values(
        userIds.map((id) => ({
          id,
          email: `batch-${id}@example.invalid`,
          displayName: "Batch fixture",
        })),
      );
      await db
        .insert(organizations)
        .values(orgIds.map((id) => ({ id, name: "Batch fixture" })));
      await db.insert(memberships).values([
        { userId: userIds[0]!, organizationId: orgIds[0]!, role: "owner" },
        { userId: userIds[1]!, organizationId: orgIds[0]!, role: "member" },
        { userId: userIds[2]!, organizationId: orgIds[1]!, role: "owner" },
      ]);
      await db.insert(sites).values(
        siteIds.map((id, index) => ({
          id,
          organizationId: orgIds[index]!,
          name: "Batch fixture",
          canonicalUrl: `https://batch-${index}.example.test/`,
          status: "active" as const,
          verifiedAt: new Date(),
        })),
      );
      await db.insert(scans).values([
        ...scanIds.slice(0, 2).map((id) => ({
          id,
          organizationId: orgIds[0]!,
          siteId: siteIds[0]!,
          trigger: "manual" as const,
          status: "completed" as const,
          scanMode: "verified_deep_audit" as const,
        })),
        {
          id: scanIds[2]!,
          organizationId: orgIds[1]!,
          siteId: siteIds[1]!,
          trigger: "manual",
          status: "completed",
          scanMode: "verified_deep_audit",
        },
      ]);
      const baseObservation = {
        organizationId: orgIds[0]!,
        siteId: siteIds[0]!,
        scanId: scanIds[0]!,
        category: "web_server",
        vendor: "apache",
        product: "http_server",
        version: null,
        versionConfidence: "unknown",
        detectionConfidence: "high",
        source: "http_header",
      };
      const [observation] = await db
        .insert(technologyObservations)
        .values({
          ...baseObservation,
          observedAt: new Date("2026-01-01T00:00:00Z"),
        })
        .returning();
      const [foreignObservation] = await db
        .insert(technologyObservations)
        .values({
          ...baseObservation,
          organizationId: orgIds[1]!,
          siteId: siteIds[1]!,
          scanId: scanIds[2]!,
        })
        .returning();
      const advisories = await db
        .insert(vulnerabilityAdvisories)
        .values(
          cveIds.map((cveId, index) => ({
            cveId,
            severity: "high" as const,
            knownExploited: index === 0,
          })),
        )
        .returning();
      const baseRule = {
        vendor: "apache",
        product: "http_server",
        versionStartIncluding: "2.4.0",
        versionEndExcluding: "2.4.64",
      };
      await db.insert(vulnerabilityAffectedProducts).values([
        { ...baseRule, advisoryId: advisories[0]!.id },
        {
          ...baseRule,
          advisoryId: advisories[1]!.id,
          versionEndExcluding: "2.4.66",
        },
        { ...baseRule, advisoryId: advisories[2]!.id, contextRequired: true },
        {
          vendor: "apache",
          product: "http_server",
          advisoryId: advisories[3]!.id,
        },
      ]);
      const matches = await db
        .insert(siteVulnerabilityMatches)
        .values(
          advisories.map((advisory) => ({
            organizationId: orgIds[0]!,
            siteId: siteIds[0]!,
            observationId: observation!.id,
            advisoryId: advisory.id,
            status: "potential",
            reason: "version-not-confirmed",
          })),
        )
        .returning();
      const input = {
        userId: userIds[0]!,
        organizationId: orgIds[0]!,
        siteId: siteIds[0]!,
        observationId: observation!.id,
        version: "2.4.65",
      };
      await expect(
        setSiteTechnologyVersion({ ...input, userId: userIds[1]! }),
      ).rejects.toBeInstanceOf(OrganizationAccessError);
      await expect(
        setSiteTechnologyVersion({ ...input, userId: userIds[2]! }),
      ).rejects.toBeInstanceOf(OrganizationAccessError);
      await expect(
        setSiteTechnologyVersion({ ...input, siteId: siteIds[1]! }),
      ).rejects.toBeInstanceOf(TechnologyVersionError);
      await expect(
        setSiteTechnologyVersion({
          ...input,
          observationId: foreignObservation!.id,
        }),
      ).rejects.toBeInstanceOf(TechnologyVersionError);
      await expect(
        setSiteTechnologyVersion({ ...input, version: "2.4" }),
      ).rejects.toBeInstanceOf(TechnologyVersionError);

      await setSiteTechnologyVersion(input);
      let current = await getSiteVulnerabilityOverview(
        userIds[0]!,
        orgIds[0]!,
        siteIds[0]!,
      );
      expect(current?.observations[0]).toMatchObject({
        version: null,
        declaredVersion: "2.4.65",
      });
      expect(current?.matches.find((m) => m.cveId === cveIds[0])).toMatchObject(
        {
          status: "not_applicable",
          versionSource: "declared",
          matchedVersion: "2.4.65",
        },
      );
      expect(current?.matches.find((m) => m.cveId === cveIds[1])).toMatchObject(
        { status: "confirmed", versionSource: "declared" },
      );
      expect(
        current?.matches.filter((m) => m.status === "potential"),
      ).toHaveLength(2);
      expect(current?.matches.map((m) => m.status)).toEqual([
        "confirmed",
        "potential",
        "potential",
        "not_applicable",
      ]);
      expect(
        await getOrganizationVulnerabilitySummary(userIds[0]!, orgIds[0]!),
      ).toMatchObject({
        potential: 2,
        confirmed: 1,
        excluded: 1,
        versionChecks: 0,
        kev: 0,
      });
      const historical = await getScanVulnerabilityOverview(
        userIds[0]!,
        orgIds[0]!,
        siteIds[0]!,
        scanIds[0]!,
      );
      expect(
        historical?.matches.every(
          (m) => m.status === "potential" && m.matchedVersion === null,
        ),
      ).toBe(true);
      expect(historical?.observations[0]?.version).toBeNull();
      expect(
        (
          await db
            .select()
            .from(siteVulnerabilityMatches)
            .where(eq(siteVulnerabilityMatches.observationId, observation!.id))
        ).every((m) => m.status === "potential" && m.matchedVersion === null),
      ).toBe(true);
      expect(
        (await db.select().from(siteTechnologyVersions)).filter(
          (d) => d.siteId === siteIds[1],
        ),
      ).toHaveLength(0);

      await setSiteVulnerabilityReview({
        userId: userIds[0]!,
        organizationId: orgIds[0]!,
        siteId: siteIds[0]!,
        matchId: matches[1]!.id,
        reviewed: true,
      });
      expect(
        await getOrganizationVulnerabilitySummary(userIds[0]!, orgIds[0]!),
      ).toMatchObject({ confirmed: 0, reviewed: 1 });
      await setSiteTechnologyVersion({ ...input, version: null });
      expect(
        await getOrganizationVulnerabilitySummary(userIds[0]!, orgIds[0]!),
      ).toMatchObject({
        potential: 4,
        excluded: 0,
        reviewed: 0,
        versionChecks: 1,
        kev: 1,
      });
      await setSiteTechnologyVersion(input);
      const [newObservation] = await db
        .insert(technologyObservations)
        .values({
          ...baseObservation,
          scanId: scanIds[1]!,
          observedAt: new Date("2026-02-01T00:00:00Z"),
        })
        .returning();
      await db.insert(siteVulnerabilityMatches).values({
        organizationId: orgIds[0]!,
        siteId: siteIds[0]!,
        observationId: newObservation!.id,
        advisoryId: advisories[0]!.id,
        status: "potential",
        reason: "version-not-confirmed",
      });
      current = await getSiteVulnerabilityOverview(
        userIds[0]!,
        orgIds[0]!,
        siteIds[0]!,
      );
      expect(current?.observations[0]).toMatchObject({
        version: null,
        declaredVersion: null,
      });
      expect(current?.matches[0]).toMatchObject({
        status: "potential",
        matchedVersion: null,
        versionSource: "observed",
      });
      await expect(setSiteTechnologyVersion(input)).rejects.toBeInstanceOf(
        TechnologyVersionError,
      );
      await db
        .update(technologyObservations)
        .set({ version: "2.4.65", versionConfidence: "exact" })
        .where(eq(technologyObservations.id, newObservation!.id));
      await expect(
        setSiteTechnologyVersion({
          ...input,
          observationId: newObservation!.id,
          version: "2.4.66",
        }),
      ).rejects.toBeInstanceOf(TechnologyVersionError);
    } finally {
      await db
        .delete(vulnerabilityAdvisories)
        .where(inArray(vulnerabilityAdvisories.cveId, cveIds));
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });
});
