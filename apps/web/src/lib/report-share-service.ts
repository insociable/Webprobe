import { ReportRecipientEmailSchema } from "@agency-saas/contracts";
import { reportDeliveries, reportShares, scans, sites } from "@agency-saas/db";
import {
  decryptReportShareToken,
  encryptReportShareToken,
  generateReportShareToken,
  getReportPublicBaseUrl,
  getReportTokenSecret,
  hashReportShareToken,
} from "@agency-saas/security";
import { and, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";

const shareLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const activeShareLimitPerScan = 20;
const reportEmailSiteHourlyLimit = 30;
const reportEmailOrganizationDailyLimit = 30;
const reportEmailSenderHourlyLimit = 30;
const reportEmailRecipientDailyLimit = 3;
const reportEmailPendingOrganizationLimit = 20;

export class ReportShareRateLimitError extends Error {
  constructor(
    message: string,
    readonly code: "share-rate-limited" | "email-rate-limited",
  ) {
    super(message);
    this.name = "ReportShareRateLimitError";
  }
}

export class ReportShareEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportShareEligibilityError";
  }
}

function tokenSecret(): string {
  return getReportTokenSecret();
}

export function reportPublicBaseUrl(): string {
  return getReportPublicBaseUrl();
}

export function reportShareUrl(token: string): string {
  return `${reportPublicBaseUrl()}/r/${encodeURIComponent(token)}`;
}
async function requireManageableCompletedScan(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
) {
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only organization owners and admins can share reports",
    );
  }

  const [scan] = await db
    .select({
      id: scans.id,
      scanMode: scans.scanMode,
      siteStatus: sites.status,
      siteVerifiedAt: sites.verifiedAt,
    })
    .from(scans)
    .innerJoin(
      sites,
      and(
        eq(scans.siteId, sites.id),
        eq(scans.organizationId, sites.organizationId),
      ),
    )
    .where(
      and(
        eq(scans.id, scanId),
        eq(scans.organizationId, organizationId),
        eq(scans.siteId, siteId),
        eq(scans.status, "completed"),
      ),
    )
    .limit(1);

  if (!scan) {
    throw new OrganizationAccessError("Completed scan not found");
  }

  return { access, scan };
}

async function requireShareableCompletedScan(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
): Promise<void> {
  const { scan } = await requireManageableCompletedScan(
    userId,
    organizationId,
    siteId,
    scanId,
  );

  if (
    scan.scanMode === "public_audit" &&
    (scan.siteStatus !== "active" || !scan.siteVerifiedAt)
  ) {
    throw new ReportShareEligibilityError(
      "Public audit reports cannot be shared before site verification",
    );
  }
}

function newShareValues(input: {
  organizationId: string;
  siteId: string;
  scanId: string;
  userId: string;
  now: Date;
}) {
  const token = generateReportShareToken();
  return {
    token,
    values: {
      organizationId: input.organizationId,
      siteId: input.siteId,
      scanId: input.scanId,
      tokenHash: hashReportShareToken(token),
      tokenCiphertext: encryptReportShareToken(token, tokenSecret()),
      expiresAt: new Date(input.now.getTime() + shareLifetimeMs),
      createdByUserId: input.userId,
      createdAt: input.now,
    },
  };
}
export async function createReportShare(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
  now = new Date(),
) {
  await requireShareableCompletedScan(userId, organizationId, siteId, scanId);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`report-share:scan:${scanId}`}, 0))`,
    );

    const [usage] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reportShares)
      .where(
        and(
          eq(reportShares.organizationId, organizationId),
          eq(reportShares.siteId, siteId),
          eq(reportShares.scanId, scanId),
          isNull(reportShares.revokedAt),
          gt(reportShares.expiresAt, now),
        ),
      );
    if ((usage?.count ?? 0) >= activeShareLimitPerScan) {
      throw new ReportShareRateLimitError(
        "Active report share quota exceeded for this scan",
        "share-rate-limited",
      );
    }

    const share = newShareValues({
      userId,
      organizationId,
      siteId,
      scanId,
      now,
    });
    const [created] = await tx
      .insert(reportShares)
      .values(share.values)
      .returning({
        id: reportShares.id,
        expiresAt: reportShares.expiresAt,
      });

    if (!created) {
      throw new Error("Report share creation failed");
    }

    return {
      id: created.id,
      url: reportShareUrl(share.token),
      expiresAt: created.expiresAt,
    };
  });
}

export async function queueReportEmail(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
  rawRecipientEmail: string,
  now = new Date(),
) {
  await requireShareableCompletedScan(userId, organizationId, siteId, scanId);
  const recipientEmail = ReportRecipientEmailSchema.parse(rawRecipientEmail);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`report-email:org:${organizationId}`}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`report-email:site:${siteId}`}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`report-email:sender:${userId}`}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`report-email:recipient:${organizationId}:${recipientEmail}`}, 0))`,
    );

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [organizationUsage] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reportDeliveries)
      .where(
        and(
          eq(reportDeliveries.organizationId, organizationId),
          gte(reportDeliveries.createdAt, oneDayAgo),
        ),
      );
    const [siteUsage] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reportDeliveries)
      .where(
        and(
          eq(reportDeliveries.organizationId, organizationId),
          eq(reportDeliveries.siteId, siteId),
          gte(reportDeliveries.createdAt, oneHourAgo),
        ),
      );
    const [recipientUsage] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reportDeliveries)
      .where(
        and(
          eq(reportDeliveries.organizationId, organizationId),
          eq(reportDeliveries.recipientEmail, recipientEmail),
          gte(reportDeliveries.createdAt, oneDayAgo),
        ),
      );
    const [senderUsage] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reportDeliveries)
      .innerJoin(
        reportShares,
        eq(reportDeliveries.reportShareId, reportShares.id),
      )
      .where(
        and(
          eq(reportDeliveries.organizationId, organizationId),
          eq(reportShares.createdByUserId, userId),
          gte(reportDeliveries.createdAt, oneHourAgo),
        ),
      );
    const [pendingUsage] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reportDeliveries)
      .where(
        and(
          eq(reportDeliveries.organizationId, organizationId),
          inArray(reportDeliveries.status, ["pending", "sending"]),
        ),
      );

    if (
      (organizationUsage?.count ?? 0) >= reportEmailOrganizationDailyLimit ||
      (siteUsage?.count ?? 0) >= reportEmailSiteHourlyLimit ||
      (senderUsage?.count ?? 0) >= reportEmailSenderHourlyLimit ||
      (recipientUsage?.count ?? 0) >= reportEmailRecipientDailyLimit ||
      (pendingUsage?.count ?? 0) >= reportEmailPendingOrganizationLimit
    ) {
      throw new ReportShareRateLimitError(
        "Report email quota exceeded",
        "email-rate-limited",
      );
    }

    const share = newShareValues({
      userId,
      organizationId,
      siteId,
      scanId,
      now,
    });
    const [created] = await tx
      .insert(reportShares)
      .values(share.values)
      .returning({
        id: reportShares.id,
        expiresAt: reportShares.expiresAt,
      });

    if (!created) {
      throw new Error("Report share creation failed");
    }

    await tx.insert(reportDeliveries).values({
      reportShareId: created.id,
      organizationId,
      siteId,
      scanId,
      recipientEmail,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return {
      shareId: created.id,
      recipientEmail,
      url: reportShareUrl(share.token),
      expiresAt: created.expiresAt,
    };
  });
}

export async function listActiveReportShares(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
  now = new Date(),
) {
  await requireManageableCompletedScan(userId, organizationId, siteId, scanId);

  const rows = await db
    .select({
      id: reportShares.id,
      tokenCiphertext: reportShares.tokenCiphertext,
      expiresAt: reportShares.expiresAt,
      createdAt: reportShares.createdAt,
    })
    .from(reportShares)
    .where(
      and(
        eq(reportShares.organizationId, organizationId),
        eq(reportShares.siteId, siteId),
        eq(reportShares.scanId, scanId),
        isNull(reportShares.revokedAt),
        gt(reportShares.expiresAt, now),
      ),
    )
    .orderBy(desc(reportShares.createdAt));

  return rows.flatMap((row) => {
    try {
      const token = decryptReportShareToken(row.tokenCiphertext, tokenSecret());
      return [
        {
          id: row.id,
          url: reportShareUrl(token),
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
        },
      ];
    } catch {
      return [];
    }
  });
}

export async function revokeReportShare(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
  shareId: string,
  now = new Date(),
): Promise<boolean> {
  await requireShareableCompletedScan(userId, organizationId, siteId, scanId);

  return db.transaction(async (tx) => {
    const revoked = await tx
      .update(reportShares)
      .set({ revokedAt: now })
      .where(
        and(
          eq(reportShares.id, shareId),
          eq(reportShares.organizationId, organizationId),
          eq(reportShares.siteId, siteId),
          eq(reportShares.scanId, scanId),
          isNull(reportShares.revokedAt),
        ),
      )
      .returning({ id: reportShares.id });

    if (revoked.length !== 1) {
      return false;
    }

    await tx
      .update(reportDeliveries)
      .set({
        status: "cancelled",
        leaseUntil: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(reportDeliveries.reportShareId, shareId),
          inArray(reportDeliveries.status, ["pending", "sending"]),
        ),
      );

    return true;
  });
}
