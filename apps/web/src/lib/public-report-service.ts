import {
  findings,
  organizations,
  reportShares,
  scans,
  sites,
} from "@agency-saas/db";
import {
  hashReportShareToken,
  isReportShareToken,
} from "@agency-saas/security";
import { and, desc, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "./database";
import { compareScanFindings } from "./scan-comparison";
import { getPrimaryScreenshotArtifactForScope } from "./scan-artifact-service";

async function loadFindings(organizationId: string, scanId: string) {
  return db
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.organizationId, organizationId),
        eq(findings.scanId, scanId),
      ),
    )
    .orderBy(findings.createdAt);
}

export async function getPublicReportByToken(token: string, now = new Date()) {
  if (!isReportShareToken(token)) {
    return null;
  }

  const tokenHash = hashReportShareToken(token);
  const [row] = await db
    .select({
      organizationId: reportShares.organizationId,
      siteId: reportShares.siteId,
      scanId: reportShares.scanId,
      expiresAt: reportShares.expiresAt,
      organizationName: organizations.name,
      brandName: organizations.reportBrandName,
      accentColor: organizations.reportAccentColor,
      siteName: sites.name,
      siteUrl: sites.canonicalUrl,
      completedAt: scans.completedAt,
      pageCount: scans.pageCount,
      scanMode: scans.scanMode,
      summary: scans.summary,
    })
    .from(reportShares)
    .innerJoin(organizations, eq(reportShares.organizationId, organizations.id))
    .innerJoin(
      sites,
      and(
        eq(reportShares.siteId, sites.id),
        eq(reportShares.organizationId, sites.organizationId),
      ),
    )
    .innerJoin(
      scans,
      and(
        eq(reportShares.scanId, scans.id),
        eq(reportShares.organizationId, scans.organizationId),
        eq(reportShares.siteId, scans.siteId),
      ),
    )
    .where(
      and(
        eq(reportShares.tokenHash, tokenHash),
        isNull(reportShares.revokedAt),
        gt(reportShares.expiresAt, now),
        eq(scans.status, "completed"),
        isNotNull(scans.completedAt),
      ),
    )
    .limit(1);

  if (!row?.completedAt) {
    return null;
  }

  const currentFindings = await loadFindings(row.organizationId, row.scanId);
  const [previousScan] = await db
    .select({ id: scans.id, summary: scans.summary })
    .from(scans)
    .where(
      and(
        eq(scans.organizationId, row.organizationId),
        eq(scans.siteId, row.siteId),
        eq(scans.scanMode, row.scanMode),
        eq(scans.status, "completed"),
        isNotNull(scans.completedAt),
        lt(scans.completedAt, row.completedAt),
      ),
    )
    .orderBy(desc(scans.completedAt), desc(scans.queuedAt))
    .limit(1);

  const comparison = previousScan
    ? compareScanFindings(
        currentFindings,
        await loadFindings(row.organizationId, previousScan.id),
        {
          current: row.summary,
          previous: previousScan.summary,
        },
      )
    : null;

  const screenshot = await getPrimaryScreenshotArtifactForScope(
    row.organizationId,
    row.siteId,
    row.scanId,
  );
  return {
    branding: {
      name: row.brandName ?? row.organizationName,
      accentColor: row.accentColor,
    },
    site: {
      name: row.siteName,
      canonicalUrl: row.siteUrl,
    },
    scan: {
      completedAt: row.completedAt,
      pageCount: row.pageCount,
      scanMode: row.scanMode,
      summary: row.summary,
      findings: currentFindings,
    },
    comparison,
    screenshotAvailable: Boolean(screenshot),
    expiresAt: row.expiresAt,
    scope: {
      organizationId: row.organizationId,
      siteId: row.siteId,
      scanId: row.scanId,
    },
  };
}
