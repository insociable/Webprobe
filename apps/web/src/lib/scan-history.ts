import { findings, scans } from "@agency-saas/db";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./database";
import {
  getSiteForOrganization,
  requireOrganizationAccess,
} from "./organization-site-service";

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

  return {
    access,
    site,
    scan,
    findings: scanFindings,
  };
}
