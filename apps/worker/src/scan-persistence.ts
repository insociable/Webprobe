import {
  findings,
  memberships,
  notificationDeliveries,
  recipientFindingIncidents,
  scanSchedules,
  scans,
  sites,
  technologyObservations,
  users,
} from "@agency-saas/db";
import {
  canCompareMissingFinding,
  canResolveFindingFromSummary,
  type ScanJob,
  type ScanResult,
  type Severity,
} from "@agency-saas/contracts";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getDatabase } from "./database.js";
import type { GeneratedFinding } from "./findings.js";
import type { HttpProbeResult } from "./http-probe.js";
import type { ScannerV2PersistentSummary } from "./scanner-v2/findings.js";
import {
  detectScanDegradations,
  filterDegradationsByMinimumSeverity,
} from "./scan-alerts.js";
import type { ScanMode } from "./scan-engine/types.js";
import type { TechnologyObservationInput } from "./technology-inventory.js";

export class ScanContextError extends Error {
  constructor(
    message: string,
    readonly code:
      | "scan-not-found"
      | "scan-not-runnable"
      | "site-not-active"
      | "schedule-not-active"
      | "scan-mode-not-allowed"
      | "target-mismatch"
      | "deep-engine-unavailable",
  ) {
    super(message);
    this.name = "ScanContextError";
  }
}

export type ValidatedScanContext = {
  scanId: string;
  organizationId: string;
  siteId: string;
  trigger: "manual" | "scheduled";
  scanMode: ScanMode;
  scheduleId: string | null;
  scheduledFor: Date | null;
  targetUrl: string;
  startedAt: Date;
};

const runnableStatuses = ["queued", "running", "failed"] as const;

function recoveryFingerprintKey(
  recipientUserId: string,
  fingerprint: string,
): string {
  return `${recipientUserId}\u0000${fingerprint}`;
}

function recoveryPayloadFingerprints(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const resolved = (payload as { resolved?: unknown }).resolved;
  if (!Array.isArray(resolved)) {
    return [];
  }

  return resolved.flatMap((item) =>
    typeof item === "object" &&
    item !== null &&
    typeof (item as { fingerprint?: unknown }).fingerprint === "string"
      ? [(item as { fingerprint: string }).fingerprint]
      : [],
  );
}

export async function validateScanContext(
  payload: ScanJob,
): Promise<ValidatedScanContext> {
  const { db } = getDatabase();

  const rows = await db
    .select({
      scanId: scans.id,
      scanStatus: scans.status,
      scanTrigger: scans.trigger,
      scanMode: scans.scanMode,
      scheduleId: scans.scheduleId,
      scheduledFor: scans.scheduledFor,
      scheduleEnabled: scanSchedules.enabled,
      startedAt: scans.startedAt,
      organizationId: scans.organizationId,
      siteId: scans.siteId,
      siteStatus: sites.status,
      siteVerifiedAt: sites.verifiedAt,
      canonicalUrl: sites.canonicalUrl,
    })
    .from(scans)
    .innerJoin(
      sites,
      and(
        eq(scans.siteId, sites.id),
        eq(scans.organizationId, sites.organizationId),
      ),
    )
    .leftJoin(
      scanSchedules,
      and(
        eq(scans.scheduleId, scanSchedules.id),
        eq(scans.organizationId, scanSchedules.organizationId),
        eq(scans.siteId, scanSchedules.siteId),
      ),
    )
    .where(
      and(
        eq(scans.id, payload.scanId),
        eq(scans.organizationId, payload.organizationId),
        eq(scans.siteId, payload.siteId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new ScanContextError("Scan context does not exist", "scan-not-found");
  }

  if (
    !runnableStatuses.includes(
      row.scanStatus as (typeof runnableStatuses)[number],
    )
  ) {
    throw new ScanContextError("Scan is not runnable", "scan-not-runnable");
  }

  if (row.scanMode === "verified_deep_audit") {
    throw new ScanContextError(
      "Verified Deep Audit is not executable until its guarded pipeline is enabled",
      "deep-engine-unavailable",
    );
  }

  if (
    row.scanMode === "verified_monitoring" &&
    (row.siteStatus !== "active" || !row.siteVerifiedAt)
  ) {
    throw new ScanContextError(
      "Verified monitoring requires an active verified site",
      "site-not-active",
    );
  }

  if (
    row.scanMode === "public_audit" &&
    row.siteStatus !== "pending_verification" &&
    row.siteStatus !== "active"
  ) {
    throw new ScanContextError(
      "Site is not eligible for a public audit",
      "site-not-active",
    );
  }

  if (
    row.scanTrigger === "scheduled" &&
    row.scanMode !== "verified_monitoring"
  ) {
    throw new ScanContextError(
      "Scheduled scans require verified monitoring mode",
      "scan-mode-not-allowed",
    );
  }

  if (
    row.scanTrigger === "scheduled" &&
    (!row.scheduleId || !row.scheduledFor || row.scheduleEnabled !== true)
  ) {
    throw new ScanContextError(
      "Scheduled scan context is not active",
      "schedule-not-active",
    );
  }

  if (row.canonicalUrl !== payload.targetUrl) {
    throw new ScanContextError(
      "Queued target does not match site",
      "target-mismatch",
    );
  }

  return {
    scanId: row.scanId,
    organizationId: row.organizationId,
    siteId: row.siteId,
    trigger: row.scanTrigger,
    scanMode: row.scanMode,
    scheduleId: row.scheduleId,
    scheduledFor: row.scheduledFor,
    targetUrl: row.canonicalUrl,
    startedAt: row.startedAt ?? new Date(),
  };
}
export async function markScanRunning(
  context: ValidatedScanContext,
): Promise<void> {
  const { db } = getDatabase();

  const siteEligibility =
    context.scanMode === "verified_monitoring"
      ? sql`exists (
          select 1
          from ${sites}
          where ${sites.id} = ${context.siteId}
            and ${sites.organizationId} = ${context.organizationId}
            and ${sites.status} = 'active'
            and ${sites.verifiedAt} is not null
            and ${sites.canonicalUrl} = ${context.targetUrl}
        )`
      : sql`exists (
          select 1
          from ${sites}
          where ${sites.id} = ${context.siteId}
            and ${sites.organizationId} = ${context.organizationId}
            and ${sites.status} in ('pending_verification', 'active')
            and ${sites.canonicalUrl} = ${context.targetUrl}
        )`;

  const updated = await db
    .update(scans)
    .set({
      status: "running",
      startedAt: context.startedAt,
      completedAt: null,
    })
    .where(
      and(
        eq(scans.id, context.scanId),
        eq(scans.organizationId, context.organizationId),
        eq(scans.siteId, context.siteId),
        eq(scans.trigger, context.trigger),
        eq(scans.scanMode, context.scanMode),
        inArray(scans.status, ["queued", "running", "failed"]),
        siteEligibility,
        context.trigger === "scheduled"
          ? sql`${scans.scheduleId} = ${context.scheduleId}
              and exists (
                select 1
                from ${scanSchedules}
                where ${scanSchedules.id} = ${context.scheduleId}
                  and ${scanSchedules.organizationId} = ${context.organizationId}
                  and ${scanSchedules.siteId} = ${context.siteId}
                  and ${scanSchedules.enabled} = true
              )`
          : sql`${scans.scheduleId} is null`,
      ),
    )
    .returning({ id: scans.id });

  if (updated.length !== 1) {
    throw new ScanContextError("Scan is not runnable", "scan-not-runnable");
  }
}

function severityCounts(generatedFindings: GeneratedFinding[]) {
  const counts: Record<Severity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const item of generatedFindings) {
    counts[item.severity] += 1;
  }

  return counts;
}

export async function persistScanCompletion(
  context: ValidatedScanContext,
  result: ScanResult,
  probe: HttpProbeResult,
  generatedFindings: GeneratedFinding[],
  scannerV2: ScannerV2PersistentSummary | null = null,
  technologies: TechnologyObservationInput[] = [],
): Promise<void> {
  const { db } = getDatabase();

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(scans)
      .set({
        status: "completed",
        pageCount: result.pagesVisited,
        completedAt: new Date(result.completedAt),
        summary: {
          targetUrl: context.targetUrl,
          http: probe,
          findingCount: generatedFindings.length,
          findingsBySeverity: severityCounts(generatedFindings),
          ...(scannerV2 ? { scannerV2 } : {}),
        },
      })
      .where(
        and(
          eq(scans.id, context.scanId),
          eq(scans.organizationId, context.organizationId),
          eq(scans.siteId, context.siteId),
          eq(scans.status, "running"),
        ),
      )
      .returning({ id: scans.id });

    if (updated.length !== 1) {
      throw new ScanContextError(
        "Scan is no longer running",
        "scan-not-runnable",
      );
    }

    await tx
      .delete(findings)
      .where(
        and(
          eq(findings.scanId, context.scanId),
          eq(findings.organizationId, context.organizationId),
        ),
      );

    if (generatedFindings.length > 0) {
      await tx.insert(findings).values(
        generatedFindings.map((item) => ({
          organizationId: context.organizationId,
          scanId: context.scanId,
          category: item.category,
          severity: item.severity,
          code: item.code,
          title: item.title,
          pageUrl: item.pageUrl,
          fingerprint: item.fingerprint,
          evidence: item.evidence,
        })),
      );
    }

    await tx
      .delete(technologyObservations)
      .where(eq(technologyObservations.scanId, context.scanId));

    if (technologies.length > 0) {
      await tx.insert(technologyObservations).values(
        technologies.map((technology) => ({
          organizationId: context.organizationId,
          siteId: context.siteId,
          scanId: context.scanId,
          category: technology.category,
          vendor: technology.vendor,
          product: technology.product,
          version: technology.version,
          versionConfidence: technology.versionConfidence,
          detectionConfidence: technology.detectionConfidence,
          source: technology.source,
          evidence: technology.evidence,
          observedAt: new Date(result.completedAt),
        })),
      );
    }

    if (context.scanMode === "public_audit") {
      return;
    }

    const [previousScan] = await tx
      .select({ id: scans.id, summary: scans.summary })
      .from(scans)
      .where(
        and(
          eq(scans.organizationId, context.organizationId),
          eq(scans.siteId, context.siteId),
          eq(scans.scanMode, context.scanMode),
          eq(scans.status, "completed"),
          ne(scans.id, context.scanId),
          isNotNull(scans.completedAt),
        ),
      )
      .orderBy(desc(scans.completedAt), desc(scans.queuedAt))
      .limit(1);

    const previousFindings = previousScan
      ? await tx
          .select({
            fingerprint: findings.fingerprint,
            severity: findings.severity,
            code: findings.code,
          })
          .from(findings)
          .where(
            and(
              eq(findings.organizationId, context.organizationId),
              eq(findings.scanId, previousScan.id),
            ),
          )
      : [];

    const currentSummary = scannerV2 ? { scannerV2 } : {};
    const degradations = previousScan
      ? detectScanDegradations(
          generatedFindings,
          previousFindings,
          previousScan.summary,
        ).filter(
          (degradation) =>
            degradation.change === "worsened" ||
            canCompareMissingFinding(
              degradation.code,
              currentSummary,
              previousScan.summary,
            ),
        )
      : [];

    const recipients = await tx
      .select({
        userId: users.id,
        email: users.email,
        minimumSeverity: memberships.scanAlertMinimumSeverity,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.organizationId, context.organizationId),
          inArray(memberships.role, ["owner", "admin"]),
          eq(memberships.scanAlertEnabled, true),
          eq(users.emailVerified, true),
        ),
      );

    if (recipients.length === 0) {
      return;
    }

    const degradationDeliveries = recipients.flatMap((recipient) => {
      if (
        recipient.minimumSeverity !== "medium" &&
        recipient.minimumSeverity !== "high" &&
        recipient.minimumSeverity !== "critical"
      ) {
        return [];
      }

      const recipientDegradations = filterDegradationsByMinimumSeverity(
        degradations,
        recipient.minimumSeverity,
      );

      if (recipientDegradations.length === 0) {
        return [];
      }

      return [
        {
          organizationId: context.organizationId,
          siteId: context.siteId,
          scanId: context.scanId,
          recipientUserId: recipient.userId,
          recipientEmail: recipient.email,
          kind: "scan-degradation",
          payload: { degradations: recipientDegradations },
        },
      ];
    });

    const activeIncidents =
      recipients.length === 0
        ? []
        : await tx
            .select({
              recipientUserId: recipientFindingIncidents.recipientUserId,
              fingerprint: recipientFindingIncidents.fingerprint,
              severity: recipientFindingIncidents.lastAlertedSeverity,
              code: recipientFindingIncidents.code,
              title: recipientFindingIncidents.title,
              pageUrl: recipientFindingIncidents.pageUrl,
            })
            .from(recipientFindingIncidents)
            .where(
              and(
                eq(
                  recipientFindingIncidents.organizationId,
                  context.organizationId,
                ),
                eq(recipientFindingIncidents.siteId, context.siteId),
                eq(recipientFindingIncidents.active, true),
                inArray(
                  recipientFindingIncidents.recipientUserId,
                  recipients.map((recipient) => recipient.userId),
                ),
              ),
            );

    const outstandingRecoveryDeliveries = await tx
      .select({
        recipientUserId: notificationDeliveries.recipientUserId,
        payload: notificationDeliveries.payload,
      })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.organizationId, context.organizationId),
          eq(notificationDeliveries.siteId, context.siteId),
          eq(notificationDeliveries.kind, "scan-recovery"),
          inArray(notificationDeliveries.status, ["pending", "sending"]),
          inArray(
            notificationDeliveries.recipientUserId,
            recipients.map((recipient) => recipient.userId),
          ),
        ),
      );

    const outstandingRecoveryKeys = new Set(
      outstandingRecoveryDeliveries.flatMap((delivery) =>
        recoveryPayloadFingerprints(delivery.payload).map((fingerprint) =>
          recoveryFingerprintKey(delivery.recipientUserId, fingerprint),
        ),
      ),
    );

    const currentFingerprints = new Set(
      generatedFindings.map((finding) => finding.fingerprint),
    );
    const recipientByUserId = new Map(
      recipients.map((recipient) => [recipient.userId, recipient]),
    );
    const resolvedByRecipient = new Map<
      string,
      Array<{
        fingerprint: string;
        severity: Severity;
        code: string;
        title: string;
        pageUrl: string;
      }>
    >();

    for (const incident of activeIncidents) {
      if (currentFingerprints.has(incident.fingerprint)) {
        continue;
      }

      if (!canResolveFindingFromSummary(incident.code, currentSummary)) {
        continue;
      }

      if (
        outstandingRecoveryKeys.has(
          recoveryFingerprintKey(
            incident.recipientUserId,
            incident.fingerprint,
          ),
        )
      ) {
        continue;
      }

      const items = resolvedByRecipient.get(incident.recipientUserId) ?? [];
      items.push({
        fingerprint: incident.fingerprint,
        severity: incident.severity,
        code: incident.code,
        title: incident.title,
        pageUrl: incident.pageUrl,
      });
      resolvedByRecipient.set(incident.recipientUserId, items);
    }

    const recoveryDeliveries = Array.from(
      resolvedByRecipient.entries(),
      ([recipientUserId, resolved]) => {
        const recipient = recipientByUserId.get(recipientUserId);
        if (!recipient) {
          return null;
        }

        return {
          organizationId: context.organizationId,
          siteId: context.siteId,
          scanId: context.scanId,
          recipientUserId,
          recipientEmail: recipient.email,
          kind: "scan-recovery",
          payload: { resolved },
        };
      },
    ).filter((delivery) => delivery !== null);

    if (degradationDeliveries.length > 0) {
      await tx
        .insert(notificationDeliveries)
        .values(degradationDeliveries)
        .onConflictDoNothing();
    }

    if (recoveryDeliveries.length > 0) {
      await tx
        .insert(notificationDeliveries)
        .values(recoveryDeliveries)
        .onConflictDoNothing();
    }
  });
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

  return "worker-error";
}

export async function persistScanFailureForJob(
  payload: Pick<ScanJob, "scanId" | "organizationId" | "siteId" | "targetUrl">,
  error: unknown,
): Promise<void> {
  const { db } = getDatabase();

  await db
    .update(scans)
    .set({
      status: "failed",
      pageCount: 0,
      completedAt: new Date(),
      summary: {
        targetUrl: payload.targetUrl,
        error: { code: safeErrorCode(error) },
      },
    })
    .where(
      and(
        eq(scans.id, payload.scanId),
        eq(scans.organizationId, payload.organizationId),
        eq(scans.siteId, payload.siteId),
        ne(scans.scanMode, "verified_deep_audit"),
        inArray(scans.status, ["running", "queued", "failed"]),
      ),
    );
}

export async function persistScanFailure(
  context: ValidatedScanContext,
  error: unknown,
): Promise<void> {
  await persistScanFailureForJob(
    {
      scanId: context.scanId,
      organizationId: context.organizationId,
      siteId: context.siteId,
      targetUrl: context.targetUrl,
    },
    error,
  );
}
