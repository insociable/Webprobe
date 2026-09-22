import { ReportRecipientEmailSchema } from "@agency-saas/contracts";
import { reportDeliveries, reportShares, scans } from "@agency-saas/db";
import {
  decryptReportShareToken,
  encryptReportShareToken,
  generateReportShareToken,
  hashReportShareToken,
} from "@agency-saas/security";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";

const shareLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function tokenSecret(): string {
  const value =
    process.env.REPORT_TOKEN_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();
  if (!value) {
    throw new Error("REPORT_TOKEN_SECRET or BETTER_AUTH_SECRET is required");
  }
  return value;
}

export function reportPublicBaseUrl(): string {
  const value =
    process.env.REPORT_PUBLIC_BASE_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    "http://localhost:3000";
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Report public base URL must use HTTP(S)");
  }
  return url.origin;
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
    .select({ id: scans.id })
    .from(scans)
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

  return access;
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
  await requireManageableCompletedScan(userId, organizationId, siteId, scanId);

  const share = newShareValues({
    userId,
    organizationId,
    siteId,
    scanId,
    now,
  });
  const [created] = await db
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
}

export async function queueReportEmail(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
  rawRecipientEmail: string,
  now = new Date(),
) {
  await requireManageableCompletedScan(userId, organizationId, siteId, scanId);
  const recipientEmail = ReportRecipientEmailSchema.parse(rawRecipientEmail);

  return db.transaction(async (tx) => {
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
  await requireManageableCompletedScan(userId, organizationId, siteId, scanId);

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
