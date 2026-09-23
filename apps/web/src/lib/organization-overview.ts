import { findings, scans, sites } from "@agency-saas/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./database";
import { requireOrganizationAccess } from "./organization-site-service";

function summaryFindingCount(summary: Record<string, unknown>): number | null {
  const value = summary.findingCount;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function getOrganizationOverview(
  userId: string,
  organizationId: string,
) {
  const access = await requireOrganizationAccess(userId, organizationId);

  const organizationSites = await db
    .select()
    .from(sites)
    .where(eq(sites.organizationId, organizationId))
    .orderBy(asc(sites.createdAt));

  if (organizationSites.length === 0) {
    return { access, sites: [] };
  }
  const latestScans = await db
    .selectDistinctOn([scans.siteId], {
      id: scans.id,
      siteId: scans.siteId,
      status: scans.status,
      trigger: scans.trigger,
      scanMode: scans.scanMode,
      summary: scans.summary,
      queuedAt: scans.queuedAt,
      startedAt: scans.startedAt,
      completedAt: scans.completedAt,
    })
    .from(scans)
    .where(eq(scans.organizationId, organizationId))
    .orderBy(scans.siteId, desc(scans.queuedAt));

  const latestScanIds = latestScans.map((scan) => scan.id);
  const severityRows =
    latestScanIds.length === 0
      ? []
      : await db
          .select({
            scanId: findings.scanId,
            highCount: sql<number>`count(*) filter (where ${findings.severity} = 'high')::int`,
            criticalCount: sql<number>`count(*) filter (where ${findings.severity} = 'critical')::int`,
          })
          .from(findings)
          .where(
            and(
              eq(findings.organizationId, organizationId),
              inArray(findings.scanId, latestScanIds),
            ),
          )
          .groupBy(findings.scanId);

  const severityByScan = new Map(
    severityRows.map((row) => [
      row.scanId,
      {
        highCount: Number(row.highCount),
        criticalCount: Number(row.criticalCount),
      },
    ]),
  );
  const latestBySite = new Map(latestScans.map((scan) => [scan.siteId, scan]));

  return {
    access,
    sites: organizationSites.map((site) => {
      const latestScan = latestBySite.get(site.id);
      if (!latestScan) {
        return { ...site, latestScan: null };
      }

      const severity = severityByScan.get(latestScan.id) ?? {
        highCount: 0,
        criticalCount: 0,
      };

      return {
        ...site,
        latestScan: {
          ...latestScan,
          findingCount: summaryFindingCount(latestScan.summary),
          ...severity,
        },
      };
    }),
  };
}
