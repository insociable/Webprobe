import { scanDispatches, scans, sites } from "@agency-saas/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./database";
import { getSiteForOrganization } from "./organization-site-service";
import { hasPostgresErrorCode } from "./postgres-error";
import {
  getPublicAuditLimits,
  type PublicAuditLimits,
} from "./public-audit-policy";

export class PublicAuditError extends Error {
  constructor(
    message: string,
    readonly code:
      | "site-not-found"
      | "site-not-eligible"
      | "user-hourly-limit"
      | "user-concurrency-limit"
      | "domain-busy"
      | "domain-cooldown"
      | "scan-already-running",
  ) {
    super(message);
    this.name = "PublicAuditError";
  }
}
function canonicalHostname(canonicalUrl: string): string {
  return new URL(canonicalUrl).hostname.toLowerCase().replace(/\.$/, "");
}

export async function createPublicAuditForSite(
  userId: string,
  organizationId: string,
  siteId: string,
  now = new Date(),
  limits: PublicAuditLimits = getPublicAuditLimits(),
) {
  const site = await getSiteForOrganization(userId, organizationId, siteId);
  if (!site) {
    throw new PublicAuditError("Site not found", "site-not-found");
  }
  if (site.status === "paused") {
    throw new PublicAuditError(
      "Paused sites cannot start a public audit",
      "site-not-eligible",
    );
  }

  const hostname = canonicalHostname(site.canonicalUrl);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const cooldownCutoff = new Date(now.getTime() - limits.domainCooldownMs);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`public-audit:user:${userId}`}, 0))`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`public-audit:domain:${hostname}`}, 0))`,
      );

      const [hourlyUsage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(scans)
        .where(
          and(
            eq(scans.scanMode, "public_audit"),
            eq(scans.requestedByUserId, userId),
            gte(scans.queuedAt, oneHourAgo),
          ),
        );

      if ((hourlyUsage?.count ?? 0) >= limits.userHourlyLimit) {
        throw new PublicAuditError(
          "Public audit hourly quota exceeded",
          "user-hourly-limit",
        );
      }
      const [concurrentUsage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(scans)
        .where(
          and(
            eq(scans.scanMode, "public_audit"),
            eq(scans.requestedByUserId, userId),
            inArray(scans.status, ["queued", "running"]),
          ),
        );

      if ((concurrentUsage?.count ?? 0) >= limits.userConcurrentLimit) {
        throw new PublicAuditError(
          "Too many public audits are already running",
          "user-concurrency-limit",
        );
      }

      const domainFilter = sql`lower(split_part(split_part(${sites.canonicalUrl}, '://', 2), '/', 1)) = ${hostname}`;

      const [domainUsage] = await tx
        .select({
          activeCount: sql<number>`count(*) filter (
            where ${scans.status} in ('queued', 'running')
          )::int`,
        })
        .from(scans)
        .innerJoin(sites, eq(scans.siteId, sites.id))
        .where(domainFilter);

      if ((domainUsage?.activeCount ?? 0) > 0) {
        throw new PublicAuditError(
          "A scan is already running for this domain",
          "domain-busy",
        );
      }

      const [latestDomainScan] = await tx
        .select({ queuedAt: scans.queuedAt })
        .from(scans)
        .innerJoin(sites, eq(scans.siteId, sites.id))
        .where(domainFilter)
        .orderBy(desc(scans.queuedAt))
        .limit(1);

      if (
        latestDomainScan?.queuedAt &&
        latestDomainScan.queuedAt.getTime() >= cooldownCutoff.getTime()
      ) {
        throw new PublicAuditError(
          "This domain was audited too recently",
          "domain-cooldown",
        );
      }

      const [created] = await tx
        .insert(scans)
        .values({
          organizationId,
          siteId,
          status: "queued",
          trigger: "manual",
          scanMode: "public_audit",
          requestedByUserId: userId,
          queuedAt: now,
        })
        .returning();

      if (!created) {
        throw new Error("Public audit creation failed");
      }

      await tx.insert(scanDispatches).values({ scanId: created.id });
      return created;
    });
  } catch (error) {
    if (hasPostgresErrorCode(error, "23505")) {
      throw new PublicAuditError(
        "A scan is already queued or running for this site",
        "scan-already-running",
      );
    }
    throw error;
  }
}
