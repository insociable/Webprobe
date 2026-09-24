import { scanDispatches, scans } from "@agency-saas/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  getSiteForOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";
import { hasPostgresErrorCode } from "./postgres-error";

export class ManualScanError extends Error {
  constructor(
    message: string,
    readonly code:
      | "site-not-found"
      | "site-not-active"
      | "scan-already-running"
      | "scan-rate-limited",
  ) {
    super(message);
    this.name = "ManualScanError";
  }
}

const manualScanSiteHourlyLimit = 3;
const manualScanOrganizationDailyLimit = 30;

export async function createManualScanForSite(
  userId: string,
  organizationId: string,
  siteId: string,
  now = new Date(),
) {
  return createManualScanForSiteMode(
    userId,
    organizationId,
    siteId,
    "verified_monitoring",
    now,
  );
}

export async function createDeepScanForSite(
  userId: string,
  organizationId: string,
  siteId: string,
  now = new Date(),
) {
  return createManualScanForSiteMode(
    userId,
    organizationId,
    siteId,
    "verified_deep_audit",
    now,
  );
}

async function createManualScanForSiteMode(
  userId: string,
  organizationId: string,
  siteId: string,
  mode: "verified_monitoring" | "verified_deep_audit",
  now: Date,
) {
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only organization owners and admins can start scans",
    );
  }

  const site = await getSiteForOrganization(userId, organizationId, siteId);
  if (!site) {
    throw new ManualScanError("Site not found", "site-not-found");
  }
  if (site.status !== "active" || !site.verifiedAt) {
    throw new ManualScanError(
      "Site must be verified and active before scanning",
      "site-not-active",
    );
  }

  let scan;
  try {
    scan = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`manual-scan:org:${organizationId}`}, 0))`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`manual-scan:site:${siteId}`}, 0))`,
      );

      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [siteUsage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(scans)
        .where(
          and(
            eq(scans.organizationId, organizationId),
            eq(scans.siteId, siteId),
            eq(scans.trigger, "manual"),
            gte(scans.queuedAt, oneHourAgo),
          ),
        );
      if ((siteUsage?.count ?? 0) >= manualScanSiteHourlyLimit) {
        throw new ManualScanError(
          "Manual scan hourly quota exceeded for this site",
          "scan-rate-limited",
        );
      }

      const [organizationUsage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(scans)
        .where(
          and(
            eq(scans.organizationId, organizationId),
            eq(scans.trigger, "manual"),
            gte(scans.queuedAt, oneDayAgo),
          ),
        );
      if ((organizationUsage?.count ?? 0) >= manualScanOrganizationDailyLimit) {
        throw new ManualScanError(
          "Manual scan daily quota exceeded for this organization",
          "scan-rate-limited",
        );
      }

      const [created] = await tx
        .insert(scans)
        .values({
          organizationId,
          siteId,
          status: "queued",
          trigger: "manual",
          scanMode: mode,
          summary:
            mode === "verified_deep_audit" ? { internalDeepWorker: true } : {},
          queuedAt: now,
        })
        .returning();

      if (!created) {
        throw new Error("Scan creation failed");
      }

      await tx.insert(scanDispatches).values({ scanId: created.id });
      return created;
    });
  } catch (error) {
    if (hasPostgresErrorCode(error, "23505")) {
      throw new ManualScanError(
        "A scan is already queued or running for this site",
        "scan-already-running",
      );
    }
    throw error;
  }

  return scan;
}
