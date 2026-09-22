import { z } from "zod";
import {
  notificationDeliveries,
  recipientFindingIncidents,
  scans,
  sites,
} from "@agency-saas/db";
import { and, asc, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { getDatabase } from "./database.js";

const degradationSchema = z.object({
  change: z.enum(["new", "worsened"]),
  fingerprint: z.string().min(1),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  previousSeverity: z
    .enum(["info", "low", "medium", "high", "critical"])
    .nullable(),
  code: z.string().min(1),
  title: z.string().min(1),
  pageUrl: z.string().min(1),
});

const degradationPayloadSchema = z.object({
  degradations: z.array(degradationSchema).min(1),
});

const recoveryItemSchema = z.object({
  fingerprint: z.string().min(1),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  code: z.string().min(1),
  title: z.string().min(1),
  pageUrl: z.string().min(1),
});

const recoveryPayloadSchema = z.object({
  resolved: z.array(recoveryItemSchema).min(1),
});

type ClaimedNotificationDeliveryBase = {
  id: string;
  organizationId: string;
  siteId: string;
  scanId: string;
  recipientUserId: string;
  recipientEmail: string;
  attemptCount: number;
  siteName: string;
  siteUrl: string;
  completedAt: Date | null;
};

export type ClaimedNotificationDelivery =
  | (ClaimedNotificationDeliveryBase & {
      kind: "scan-degradation";
      payload: z.infer<typeof degradationPayloadSchema>;
    })
  | (ClaimedNotificationDeliveryBase & {
      kind: "scan-recovery";
      payload: z.infer<typeof recoveryPayloadSchema>;
    });

function parseNotificationPayload(
  kind: string,
  payload: unknown,
):
  | {
      kind: "scan-degradation";
      payload: z.infer<typeof degradationPayloadSchema>;
    }
  | {
      kind: "scan-recovery";
      payload: z.infer<typeof recoveryPayloadSchema>;
    } {
  if (kind === "scan-degradation") {
    return {
      kind,
      payload: degradationPayloadSchema.parse(payload),
    };
  }

  if (kind === "scan-recovery") {
    return {
      kind,
      payload: recoveryPayloadSchema.parse(payload),
    };
  }

  throw new Error("Unsupported notification kind");
}

export type NotificationSender = (
  delivery: ClaimedNotificationDelivery,
) => Promise<void>;

export type NotificationDispatchResult = {
  attempted: number;
  sent: number;
  failed: number;
};

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

  return "notification-send-failed";
}

function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 6));
  return Math.min(60 * 60_000, 60_000 * 2 ** exponent);
}

export async function claimDueNotificationDeliveries(
  now = new Date(),
  batchSize = 25,
  leaseMs = 5 * 60_000,
): Promise<ClaimedNotificationDelivery[]> {
  const { db } = getDatabase();
  const leaseUntil = new Date(now.getTime() + leaseMs);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: notificationDeliveries.id,
        organizationId: notificationDeliveries.organizationId,
        siteId: notificationDeliveries.siteId,
        scanId: notificationDeliveries.scanId,
        recipientUserId: notificationDeliveries.recipientUserId,
        recipientEmail: notificationDeliveries.recipientEmail,
        kind: notificationDeliveries.kind,
        payload: notificationDeliveries.payload,
        siteName: sites.name,
        siteUrl: sites.canonicalUrl,
        completedAt: scans.completedAt,
      })
      .from(notificationDeliveries)
      .innerJoin(
        sites,
        and(
          eq(notificationDeliveries.siteId, sites.id),
          eq(notificationDeliveries.organizationId, sites.organizationId),
        ),
      )
      .innerJoin(
        scans,
        and(
          eq(notificationDeliveries.scanId, scans.id),
          eq(notificationDeliveries.siteId, scans.siteId),
          eq(notificationDeliveries.organizationId, scans.organizationId),
        ),
      )
      .where(
        or(
          and(
            eq(notificationDeliveries.status, "pending"),
            lte(notificationDeliveries.nextAttemptAt, now),
          ),
          and(
            eq(notificationDeliveries.status, "sending"),
            isNotNull(notificationDeliveries.leaseUntil),
            lte(notificationDeliveries.leaseUntil, now),
          ),
        ),
      )
      .orderBy(
        asc(notificationDeliveries.nextAttemptAt),
        asc(notificationDeliveries.createdAt),
      )
      .limit(batchSize)
      .for("update", {
        of: notificationDeliveries,
        skipLocked: true,
      });

    const claimed: ClaimedNotificationDelivery[] = [];

    for (const row of rows) {
      const [updated] = await tx
        .update(notificationDeliveries)
        .set({
          status: "sending",
          attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
          leaseUntil,
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, row.id))
        .returning({
          attemptCount: notificationDeliveries.attemptCount,
        });

      if (!updated) {
        continue;
      }

      const parsed = parseNotificationPayload(row.kind, row.payload);

      claimed.push({
        id: row.id,
        organizationId: row.organizationId,
        siteId: row.siteId,
        scanId: row.scanId,
        recipientUserId: row.recipientUserId,
        recipientEmail: row.recipientEmail,
        attemptCount: updated.attemptCount,
        siteName: row.siteName,
        siteUrl: row.siteUrl,
        completedAt: row.completedAt,
        ...parsed,
      });
    }

    return claimed;
  });
}

async function markNotificationSent(
  delivery: ClaimedNotificationDelivery,
  now: Date,
): Promise<boolean> {
  const { db } = getDatabase();

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(notificationDeliveries)
      .set({
        status: "sent",
        sentAt: now,
        leaseUntil: null,
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationDeliveries.id, delivery.id),
          eq(notificationDeliveries.status, "sending"),
          eq(notificationDeliveries.attemptCount, delivery.attemptCount),
        ),
      )
      .returning({ id: notificationDeliveries.id });

    if (updated.length !== 1) {
      return false;
    }

    if (delivery.kind === "scan-degradation") {
      for (const degradation of delivery.payload.degradations) {
        await tx
          .insert(recipientFindingIncidents)
          .values({
            organizationId: delivery.organizationId,
            siteId: delivery.siteId,
            recipientUserId: delivery.recipientUserId,
            fingerprint: degradation.fingerprint,
            code: degradation.code,
            title: degradation.title,
            pageUrl: degradation.pageUrl,
            active: true,
            lastAlertedSeverity: degradation.severity,
            openedScanId: delivery.scanId,
            openedAt: now,
            resolvedScanId: null,
            resolvedAt: null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              recipientFindingIncidents.recipientUserId,
              recipientFindingIncidents.siteId,
              recipientFindingIncidents.fingerprint,
            ],
            set: {
              organizationId: delivery.organizationId,
              code: degradation.code,
              title: degradation.title,
              pageUrl: degradation.pageUrl,
              active: true,
              lastAlertedSeverity: degradation.severity,
              openedScanId: delivery.scanId,
              openedAt: now,
              resolvedScanId: null,
              resolvedAt: null,
              updatedAt: now,
            },
          });
      }
    } else {
      for (const resolved of delivery.payload.resolved) {
        await tx
          .update(recipientFindingIncidents)
          .set({
            active: false,
            resolvedScanId: delivery.scanId,
            resolvedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(
                recipientFindingIncidents.organizationId,
                delivery.organizationId,
              ),
              eq(recipientFindingIncidents.siteId, delivery.siteId),
              eq(
                recipientFindingIncidents.recipientUserId,
                delivery.recipientUserId,
              ),
              eq(recipientFindingIncidents.fingerprint, resolved.fingerprint),
              eq(recipientFindingIncidents.active, true),
            ),
          );
      }
    }

    return true;
  });
}

async function markNotificationRetry(
  delivery: ClaimedNotificationDelivery,
  error: unknown,
  now: Date,
): Promise<boolean> {
  const { db } = getDatabase();
  const nextAttemptAt = new Date(
    now.getTime() + retryDelayMs(delivery.attemptCount),
  );

  const updated = await db
    .update(notificationDeliveries)
    .set({
      status: "pending",
      nextAttemptAt,
      leaseUntil: null,
      lastErrorCode: safeErrorCode(error),
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationDeliveries.id, delivery.id),
        eq(notificationDeliveries.status, "sending"),
        eq(notificationDeliveries.attemptCount, delivery.attemptCount),
      ),
    )
    .returning({ id: notificationDeliveries.id });

  return updated.length === 1;
}

export async function dispatchDueNotificationDeliveries(
  sender: NotificationSender,
  now = new Date(),
  batchSize = 25,
): Promise<NotificationDispatchResult> {
  const deliveries = await claimDueNotificationDeliveries(now, batchSize);
  let sent = 0;
  let failed = 0;

  for (const delivery of deliveries) {
    try {
      await sender(delivery);
      if (await markNotificationSent(delivery, new Date())) {
        sent += 1;
      }
    } catch (error) {
      await markNotificationRetry(delivery, error, new Date());
      failed += 1;
    }
  }

  return {
    attempted: deliveries.length,
    sent,
    failed,
  };
}

export function startNotificationDeliveryCoordinator(options: {
  sender: NotificationSender;
  logger: Logger;
  intervalMs?: number;
}) {
  const intervalMs = options.intervalMs ?? 30_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current = Promise.resolve();

  const execute = async () => {
    try {
      const result = await dispatchDueNotificationDeliveries(options.sender);
      if (result.attempted > 0 || result.failed > 0) {
        options.logger.info(
          {
            notificationsAttempted: result.attempted,
            notificationsSent: result.sent,
            notificationsFailed: result.failed,
          },
          "notification delivery coordinator tick",
        );
      }
    } catch (error) {
      options.logger.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorCode: safeErrorCode(error),
        },
        "notification delivery coordinator tick failed",
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
      if (timer) {
        clearTimeout(timer);
      }
      await current;
    },
  };
}
