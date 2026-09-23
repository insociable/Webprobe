import { findings, scanArtifacts, scans } from "@agency-saas/db";
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "./database";
import {
  getSiteForOrganization,
  requireOrganizationAccess,
} from "./organization-site-service";
import { compareScanFindings } from "./scan-comparison";

export async function getSiteScanHistory(
  userId: string,
  organizationId: string,
  siteId: string,
) {
  const access = await requireOrganizationAccess(userId, organizationId);

  const site = await getSiteForOrganization(userId, organizationId, siteId);
  if (!site) {
    return null;
  }

  const recentScans = await db
    .select({
      id: scans.id,
      status: scans.status,
      trigger: scans.trigger,
      scanMode: scans.scanMode,
      pageCount: scans.pageCount,
      summary: scans.summary,
      queuedAt: scans.queuedAt,
      startedAt: scans.startedAt,
      completedAt: scans.completedAt,
    })
    .from(scans)
    .where(
      and(eq(scans.organizationId, organizationId), eq(scans.siteId, siteId)),
    )
    .orderBy(desc(scans.queuedAt))
    .limit(20);

  return {
    access,
    site,
    scans: recentScans,
  };
}

export async function getScanDetailsForSite(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
) {
  const access = await requireOrganizationAccess(userId, organizationId);

  const site = await getSiteForOrganization(userId, organizationId, siteId);
  if (!site) {
    return null;
  }

  const scanRows = await db
    .select()
    .from(scans)
    .where(
      and(
        eq(scans.id, scanId),
        eq(scans.organizationId, organizationId),
        eq(scans.siteId, siteId),
      ),
    )
    .limit(1);

  const scan = scanRows[0];
  if (!scan) {
    return null;
  }

  const scanFindings = await db
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.organizationId, organizationId),
        eq(findings.scanId, scanId),
      ),
    )
    .orderBy(findings.createdAt);

  const [screenshotArtifact] = await db
    .select({ id: scanArtifacts.id })
    .from(scanArtifacts)
    .where(
      and(
        eq(scanArtifacts.organizationId, organizationId),
        eq(scanArtifacts.siteId, siteId),
        eq(scanArtifacts.scanId, scanId),
        eq(scanArtifacts.kind, "primary-screenshot"),
      ),
    )
    .limit(1);

  let comparison = null;

  if (scan.status === "completed" && scan.completedAt) {
    const [previousScan] = await db
      .select({
        id: scans.id,
        completedAt: scans.completedAt,
        summary: scans.summary,
      })
      .from(scans)
      .where(
        and(
          eq(scans.organizationId, organizationId),
          eq(scans.siteId, siteId),
          eq(scans.scanMode, scan.scanMode),
          eq(scans.status, "completed"),
          isNotNull(scans.completedAt),
          lt(scans.completedAt, scan.completedAt),
        ),
      )
      .orderBy(desc(scans.completedAt), desc(scans.queuedAt))
      .limit(1);

    if (previousScan) {
      const previousFindings = await db
        .select()
        .from(findings)
        .where(
          and(
            eq(findings.organizationId, organizationId),
            eq(findings.scanId, previousScan.id),
          ),
        )
        .orderBy(findings.createdAt);

      comparison = {
        previousScanId: previousScan.id,
        previousCompletedAt: previousScan.completedAt,
        ...compareScanFindings(scanFindings, previousFindings, {
          current: scan.summary,
          previous: previousScan.summary,
        }),
      };
    }
  }

  return {
    access,
    site,
    scan,
    findings: scanFindings,
    comparison,
    screenshotAvailable: Boolean(screenshotArtifact),
  };
}
