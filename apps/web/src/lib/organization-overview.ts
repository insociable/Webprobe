import {
  findingRemediations,
  findings,
  scans,
  scanSchedules,
  sites,
} from "@agency-saas/db";
import { canCompareNewFinding } from "@agency-saas/contracts";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
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
  const scheduleRows = await db
    .select({
      siteId: scanSchedules.siteId,
      enabled: scanSchedules.enabled,
      nextRunAt: scanSchedules.nextRunAt,
    })
    .from(scanSchedules)
    .where(eq(scanSchedules.organizationId, organizationId));
  const scheduleBySite = new Map(
    scheduleRows.map((schedule) => [schedule.siteId, schedule]),
  );

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
  const latestCompleted = latestScans.filter(
    (scan) => scan.status === "completed",
  );
  const previousScans =
    latestCompleted.length === 0
      ? []
      : await db
          .selectDistinctOn([scans.siteId, scans.scanMode], {
            id: scans.id,
            siteId: scans.siteId,
            scanMode: scans.scanMode,
            summary: scans.summary,
            completedAt: scans.completedAt,
          })
          .from(scans)
          .where(
            and(
              eq(scans.organizationId, organizationId),
              eq(scans.status, "completed"),
              notInArray(scans.id, latestScanIds),
            ),
          )
          .orderBy(
            scans.siteId,
            scans.scanMode,
            desc(scans.completedAt),
            desc(scans.queuedAt),
          );
  const previousBySiteMode = new Map(
    previousScans.map((scan) => [`${scan.siteId}:${scan.scanMode}`, scan]),
  );
  const comparisonIds = [
    ...latestCompleted.map((scan) => scan.id),
    ...previousScans.map((scan) => scan.id),
  ];
  const comparisonFindings =
    comparisonIds.length === 0
      ? []
      : await db
          .select({
            scanId: findings.scanId,
            fingerprint: findings.fingerprint,
            code: findings.code,
            category: findings.category,
            severity: findings.severity,
          })
          .from(findings)
          .where(
            and(
              eq(findings.organizationId, organizationId),
              inArray(findings.scanId, comparisonIds),
            ),
          );
  const findingsByScan = new Map<string, typeof comparisonFindings>();
  for (const finding of comparisonFindings) {
    const group = findingsByScan.get(finding.scanId) ?? [];
    group.push(finding);
    findingsByScan.set(finding.scanId, group);
  }
  const newMajorByScan = new Map(
    latestCompleted.map((scan) => {
      const previous = previousBySiteMode.get(
        `${scan.siteId}:${scan.scanMode}`,
      );
      const oldFingerprints = new Set(
        previous
          ? (findingsByScan.get(previous.id) ?? []).map(
              (finding) => finding.fingerprint,
            )
          : [],
      );
      const count =
        previous &&
        previous.completedAt &&
        scan.completedAt &&
        previous.completedAt.getTime() < scan.completedAt.getTime()
          ? (findingsByScan.get(scan.id) ?? []).filter(
              (finding) =>
                (finding.severity === "high" ||
                  finding.severity === "critical") &&
                !oldFingerprints.has(finding.fingerprint) &&
                canCompareNewFinding(
                  previous.summary,
                  finding.category,
                  finding.code,
                ),
            ).length
          : 0;
      return [scan.id, count] as const;
    }),
  );
  const openFollowups = await db
    .select({
      siteId: findingRemediations.siteId,
      count: sql<number>`count(*)::int`,
    })
    .from(findingRemediations)
    .where(
      and(
        eq(findingRemediations.organizationId, organizationId),
        inArray(findingRemediations.status, [
          "todo",
          "in_progress",
          "to_verify",
        ]),
      ),
    )
    .groupBy(findingRemediations.siteId);
  const openFollowupsBySite = new Map(
    openFollowups.map((row) => [row.siteId, Number(row.count)]),
  );
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
        return {
          ...site,
          monitoringScheduleEnabled:
            scheduleBySite.get(site.id)?.enabled ?? false,
          monitoringNextRunAt: scheduleBySite.get(site.id)?.nextRunAt ?? null,
          openFollowupCount: openFollowupsBySite.get(site.id) ?? 0,
          latestScan: null,
        };
      }

      const severity = severityByScan.get(latestScan.id) ?? {
        highCount: 0,
        criticalCount: 0,
      };

      return {
        ...site,
        monitoringScheduleEnabled:
          scheduleBySite.get(site.id)?.enabled ?? false,
        monitoringNextRunAt: scheduleBySite.get(site.id)?.nextRunAt ?? null,
        openFollowupCount: openFollowupsBySite.get(site.id) ?? 0,
        latestScan: {
          ...latestScan,
          findingCount: summaryFindingCount(latestScan.summary),
          ...severity,
          newMajorCount: newMajorByScan.get(latestScan.id) ?? 0,
        },
      };
    }),
  };
}
