import {
  organizations,
  reportDeliveries,
  reportShares,
  scans,
  sites,
} from "@agency-saas/db";
import { decryptReportShareToken } from "@agency-saas/security";
import { and, asc, eq, isNotNull, lte, or } from "drizzle-orm";
import type { Logger } from "pino";
import { getDatabase } from "./database.js";
import { getSmtpTransporter } from "./smtp.js";

export type ClaimedReportDelivery = {
  id: string;
  shareId: string;
  organizationId: string;
  siteId: string;
  scanId: string;
  recipientEmail: string;
  attemptCount: number;
  tokenCiphertext: string;
  expiresAt: Date;
  brandName: string;
  accentColor: string;
  siteName: string;
  siteUrl: string;
  completedAt: Date | null;
};

export type ReportDispatchResult = {
  attempted: number;
  sent: number;
  failed: number;
  cancelled: number;
};

function tokenSecret(): string {
  const value =
    process.env.REPORT_TOKEN_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();
  if (!value) {
    throw new Error("REPORT_TOKEN_SECRET or BETTER_AUTH_SECRET is required");
  }
  return value;
}

function reportBaseUrl(): string {
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
function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 6));
  return Math.min(60 * 60_000, 60_000 * 2 ** exponent);
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 120);
  }
  if (error instanceof Error && error.name) {
    return error.name.slice(0, 120);
  }
  return "report-send-failed";
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatScanDate(value: Date | null): string {
  return value
    ? new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Paris",
      }).format(value)
    : "date inconnue";
}

export async function sendBrandedReportEmail(
  delivery: ClaimedReportDelivery,
): Promise<void> {
  const token = decryptReportShareToken(
    delivery.tokenCiphertext,
    tokenSecret(),
  );
  const reportUrl = reportBaseUrl() + "/r/" + encodeURIComponent(token);
  const fromAddress = process.env.SMTP_FROM ?? "no-reply@agency-monitor.local";
  const brandName = delivery.brandName.trim() || "Agency Monitor";

  await getSmtpTransporter().sendMail({
    from: { name: brandName, address: fromAddress },
    to: delivery.recipientEmail,
    messageId:
      "<agency-monitor-report-" + delivery.id + "@agency-monitor.local>",
    subject: "[" + brandName + "] Rapport — " + delivery.siteName,
    text: [
      brandName +
        " vous partage le rapport de surveillance de " +
        delivery.siteName +
        ".",
      "",
      "Site : " + delivery.siteUrl,
      "Scan : " + formatScanDate(delivery.completedAt),
      "Rapport : " + reportUrl,
      "",
      "Ce lien est temporaire et révocable.",
    ].join("\n"),
    html:
      '<div style="font-family:system-ui,sans-serif;max-width:640px;margin:auto">' +
      '<p style="font-weight:700;color:' +
      htmlEscape(delivery.accentColor) +
      '">' +
      htmlEscape(brandName) +
      "</p>" +
      "<h1>Rapport de surveillance</h1>" +
      "<p>Le rapport de <strong>" +
      htmlEscape(delivery.siteName) +
      "</strong> est disponible.</p>" +
      '<p><a href="' +
      htmlEscape(reportUrl) +
      '" style="display:inline-block;padding:12px 18px;border-radius:8px;background:' +
      htmlEscape(delivery.accentColor) +
      ';color:#07120e;text-decoration:none;font-weight:700">Voir le rapport</a></p>' +
      '<p style="font-size:12px;color:#666">Ce lien est temporaire et révocable.</p>' +
      "</div>",
  });
}

export async function claimDueReportDeliveries(
  now = new Date(),
  batchSize = 25,
  leaseMs = 5 * 60_000,
): Promise<{ deliveries: ClaimedReportDelivery[]; cancelled: number }> {
  const { db } = getDatabase();
  const leaseUntil = new Date(now.getTime() + leaseMs);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: reportDeliveries.id,
        shareId: reportDeliveries.reportShareId,
        organizationId: reportDeliveries.organizationId,
        siteId: reportDeliveries.siteId,
        scanId: reportDeliveries.scanId,
        recipientEmail: reportDeliveries.recipientEmail,
        attemptCount: reportDeliveries.attemptCount,
        tokenCiphertext: reportShares.tokenCiphertext,
        expiresAt: reportShares.expiresAt,
        revokedAt: reportShares.revokedAt,
        organizationName: organizations.name,
        reportBrandName: organizations.reportBrandName,
        accentColor: organizations.reportAccentColor,
        siteName: sites.name,
        siteUrl: sites.canonicalUrl,
        completedAt: scans.completedAt,
        scanStatus: scans.status,
      })
      .from(reportDeliveries)
      .innerJoin(
        reportShares,
        eq(reportDeliveries.reportShareId, reportShares.id),
      )
      .innerJoin(
        organizations,
        eq(reportDeliveries.organizationId, organizations.id),
      )
      .innerJoin(
        sites,
        and(
          eq(reportDeliveries.siteId, sites.id),
          eq(reportDeliveries.organizationId, sites.organizationId),
        ),
      )
      .innerJoin(
        scans,
        and(
          eq(reportDeliveries.scanId, scans.id),
          eq(reportDeliveries.organizationId, scans.organizationId),
          eq(reportDeliveries.siteId, scans.siteId),
        ),
      )
      .where(
        or(
          and(
            eq(reportDeliveries.status, "pending"),
            lte(reportDeliveries.nextAttemptAt, now),
          ),
          and(
            eq(reportDeliveries.status, "sending"),
            isNotNull(reportDeliveries.leaseUntil),
            lte(reportDeliveries.leaseUntil, now),
          ),
        ),
      )
      .orderBy(
        asc(reportDeliveries.nextAttemptAt),
        asc(reportDeliveries.createdAt),
      )
      .limit(batchSize)
      .for("update", { of: reportDeliveries, skipLocked: true });

    const claimed: ClaimedReportDelivery[] = [];
    let cancelled = 0;

    for (const row of rows) {
      const invalid =
        row.revokedAt !== null ||
        row.expiresAt.getTime() <= now.getTime() ||
        row.scanStatus !== "completed";

      if (invalid) {
        const updated = await tx
          .update(reportDeliveries)
          .set({
            status: "cancelled",
            leaseUntil: null,
            updatedAt: now,
          })
          .where(eq(reportDeliveries.id, row.id))
          .returning({ id: reportDeliveries.id });
        if (updated.length === 1) cancelled += 1;
        continue;
      }

      const nextAttemptCount = row.attemptCount + 1;
      const [updated] = await tx
        .update(reportDeliveries)
        .set({
          status: "sending",
          attemptCount: nextAttemptCount,
          leaseUntil,
          updatedAt: now,
        })
        .where(eq(reportDeliveries.id, row.id))
        .returning({ attemptCount: reportDeliveries.attemptCount });

      if (!updated) continue;
      claimed.push({
        id: row.id,
        shareId: row.shareId,
        organizationId: row.organizationId,
        siteId: row.siteId,
        scanId: row.scanId,
        recipientEmail: row.recipientEmail,
        attemptCount: updated.attemptCount,
        tokenCiphertext: row.tokenCiphertext,
        expiresAt: row.expiresAt,
        brandName: row.reportBrandName ?? row.organizationName,
        accentColor: row.accentColor,
        siteName: row.siteName,
        siteUrl: row.siteUrl,
        completedAt: row.completedAt,
      });
    }

    return { deliveries: claimed, cancelled };
  });
}

async function markReportSent(
  delivery: ClaimedReportDelivery,
  now: Date,
): Promise<boolean> {
  const { db } = getDatabase();
  const updated = await db
    .update(reportDeliveries)
    .set({
      status: "sent",
      sentAt: now,
      leaseUntil: null,
      lastErrorCode: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(reportDeliveries.id, delivery.id),
        eq(reportDeliveries.status, "sending"),
        eq(reportDeliveries.attemptCount, delivery.attemptCount),
      ),
    )
    .returning({ id: reportDeliveries.id });
  return updated.length === 1;
}

async function markReportRetry(
  delivery: ClaimedReportDelivery,
  error: unknown,
  now: Date,
): Promise<boolean> {
  const { db } = getDatabase();
  const updated = await db
    .update(reportDeliveries)
    .set({
      status: "pending",
      nextAttemptAt: new Date(
        now.getTime() + retryDelayMs(delivery.attemptCount),
      ),
      leaseUntil: null,
      lastErrorCode: safeErrorCode(error),
      updatedAt: now,
    })
    .where(
      and(
        eq(reportDeliveries.id, delivery.id),
        eq(reportDeliveries.status, "sending"),
        eq(reportDeliveries.attemptCount, delivery.attemptCount),
      ),
    )
    .returning({ id: reportDeliveries.id });
  return updated.length === 1;
}

export async function dispatchDueReportDeliveries(
  sender = sendBrandedReportEmail,
  now = new Date(),
  batchSize = 25,
): Promise<ReportDispatchResult> {
  const claimed = await claimDueReportDeliveries(now, batchSize);
  let sent = 0;
  let failed = 0;

  for (const delivery of claimed.deliveries) {
    try {
      await sender(delivery);
      if (await markReportSent(delivery, new Date())) {
        sent += 1;
      }
    } catch (error) {
      await markReportRetry(delivery, error, new Date());
      failed += 1;
    }
  }

  return {
    attempted: claimed.deliveries.length,
    sent,
    failed,
    cancelled: claimed.cancelled,
  };
}

export function startReportDeliveryCoordinator(options: {
  logger: Logger;
  intervalMs?: number;
}) {
  const intervalMs = options.intervalMs ?? 30_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current = Promise.resolve();

  const execute = async () => {
    try {
      const result = await dispatchDueReportDeliveries();
      if (result.attempted > 0 || result.cancelled > 0 || result.failed > 0) {
        options.logger.info(
          {
            reportsAttempted: result.attempted,
            reportsSent: result.sent,
            reportsFailed: result.failed,
            reportsCancelled: result.cancelled,
          },
          "report delivery coordinator tick",
        );
      }
    } catch (error) {
      options.logger.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorCode: safeErrorCode(error),
        },
        "report delivery coordinator tick failed",
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          current = execute();
        }, intervalMs);
      }
    }
  };
  current = execute();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      await current;
    },
  };
}
