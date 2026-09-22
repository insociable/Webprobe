import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { ScanResult } from "@agency-saas/contracts";
import {
  memberships,
  notificationDeliveries,
  organizations,
  recipientFindingIncidents,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import type { GeneratedFinding } from "../src/findings.js";
import type { HttpProbeResult } from "../src/http-probe.js";
import { dispatchDueNotificationDeliveries } from "../src/notification-delivery.js";
import {
  persistScanCompletion,
  type ValidatedScanContext,
} from "../src/scan-persistence.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

afterAll(async () => {
  await closeDatabase();
});
function successfulProbe(): Extract<HttpProbeResult, { ok: true }> {
  return {
    ok: true,
    finalUrl: "https://example.com/",
    statusCode: 200,
    durationMs: 100,
    redirects: [],
    headers: { "content-type": "text/html" },
    securityHeaders: [],
    tls: null,
  };
}

function scanResult(
  scanId: string,
  startedAt: Date,
  completedAt: Date,
): ScanResult {
  return {
    scanId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    status: "completed",
    pagesVisited: 1,
    findings: [],
  };
}

const highFinding: GeneratedFinding = {
  category: "availability",
  severity: "high",
  code: "availability.http-5xx",
  title: "Le site retourne une erreur serveur",
  pageUrl: "https://example.com/",
  fingerprint: "r".repeat(64),
  evidence: { statusCode: 503 },
};

type Fixture = {
  organizationId: string;
  siteId: string;
  ownerUserId: string;
  adminUserId: string;
  nextScanOffsetMinutes: number;
};

async function createFixture(): Promise<Fixture> {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const ownerUserId = randomUUID();
  const adminUserId = randomUUID();
  const baselineScanId = randomUUID();

  await db.insert(users).values([
    {
      id: ownerUserId,
      email: `recovery-owner-${ownerUserId}@example.invalid`,
      displayName: "Recovery owner",
      emailVerified: true,
    },
    {
      id: adminUserId,
      email: `recovery-admin-${adminUserId}@example.invalid`,
      displayName: "Recovery admin",
      emailVerified: true,
    },
  ]);
  await db.insert(organizations).values({
    id: organizationId,
    name: "Recovery notification test",
  });
  await db.insert(memberships).values([
    {
      organizationId,
      userId: ownerUserId,
      role: "owner",
      scanAlertEnabled: true,
      scanAlertMinimumSeverity: "medium",
    },
    {
      organizationId,
      userId: adminUserId,
      role: "admin",
      scanAlertEnabled: true,
      scanAlertMinimumSeverity: "critical",
    },
  ]);
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Recovery target",
    canonicalUrl: "https://example.com/",
    status: "active",
    verifiedAt: new Date(),
  });
  await db.insert(scans).values({
    id: baselineScanId,
    organizationId,
    siteId,
    trigger: "manual",
    status: "completed",
    queuedAt: new Date("2026-09-22T07:59:00.000Z"),
    startedAt: new Date("2026-09-22T08:00:00.000Z"),
    completedAt: new Date("2026-09-22T08:01:00.000Z"),
  });

  return {
    organizationId,
    siteId,
    ownerUserId,
    adminUserId,
    nextScanOffsetMinutes: 0,
  };
}

async function createRunningScan(
  fixture: Fixture,
): Promise<ValidatedScanContext> {
  const { db } = getDatabase();
  const scanId = randomUUID();
  const startedAt = new Date(
    new Date("2026-09-22T09:00:00.000Z").getTime() +
      fixture.nextScanOffsetMinutes * 60_000,
  );
  fixture.nextScanOffsetMinutes += 10;

  await db.insert(scans).values({
    id: scanId,
    organizationId: fixture.organizationId,
    siteId: fixture.siteId,
    trigger: "manual",
    status: "running",
    queuedAt: new Date(startedAt.getTime() - 60_000),
    startedAt,
  });

  return {
    scanId,
    organizationId: fixture.organizationId,
    siteId: fixture.siteId,
    trigger: "manual",
    scheduleId: null,
    scheduledFor: null,
    targetUrl: "https://example.com/",
    startedAt,
  };
}

async function completeScan(
  context: ValidatedScanContext,
  generatedFindings: GeneratedFinding[],
): Promise<void> {
  await persistScanCompletion(
    context,
    scanResult(
      context.scanId,
      context.startedAt,
      new Date(context.startedAt.getTime() + 60_000),
    ),
    successfulProbe(),
    generatedFindings,
  );
}

async function cleanup(fixture: Fixture): Promise<void> {
  const { db } = getDatabase();
  await db
    .delete(organizations)
    .where(eq(organizations.id, fixture.organizationId));
  await db.delete(users).where(eq(users.id, fixture.ownerUserId));
  await db.delete(users).where(eq(users.id, fixture.adminUserId));
}

async function dispatchForScan(
  scanId: string,
  sender: Parameters<typeof dispatchDueNotificationDeliveries>[0] = async () =>
    undefined,
) {
  const { db } = getDatabase();
  await db
    .update(notificationDeliveries)
    .set({ nextAttemptAt: new Date("2000-01-01T00:00:00.000Z") })
    .where(eq(notificationDeliveries.scanId, scanId));

  return dispatchDueNotificationDeliveries(
    sender,
    new Date("2000-01-01T00:01:00.000Z"),
    1,
  );
}

async function dispatchSuccessfully(scanId: string): Promise<void> {
  const result = await dispatchForScan(scanId);
  expect(result).toEqual({ attempted: 1, sent: 1, failed: 0 });
}

describeDatabase("recovery alert lifecycle", () => {
  it("opens an incident only after degradation delivery and closes it after recovery delivery", async () => {
    const fixture = await createFixture();

    try {
      const degradedScan = await createRunningScan(fixture);
      await completeScan(degradedScan, [highFinding]);

      await dispatchSuccessfully(degradedScan.scanId);

      const { db } = getDatabase();
      const [openedIncident] = await db
        .select({
          active: recipientFindingIncidents.active,
          recipientUserId: recipientFindingIncidents.recipientUserId,
          openedScanId: recipientFindingIncidents.openedScanId,
        })
        .from(recipientFindingIncidents)
        .where(
          and(
            eq(
              recipientFindingIncidents.organizationId,
              fixture.organizationId,
            ),
            eq(recipientFindingIncidents.siteId, fixture.siteId),
          ),
        );

      expect(openedIncident).toMatchObject({
        active: true,
        recipientUserId: fixture.ownerUserId,
        openedScanId: degradedScan.scanId,
      });

      const unchangedScan = await createRunningScan(fixture);
      await completeScan(unchangedScan, [highFinding]);

      const unchangedRecoveries = await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.scanId, unchangedScan.scanId),
            eq(notificationDeliveries.kind, "scan-recovery"),
          ),
        );
      expect(unchangedRecoveries).toHaveLength(0);

      const recoveredScan = await createRunningScan(fixture);
      await completeScan(recoveredScan, []);

      const recoveryRows = await db
        .select({
          status: notificationDeliveries.status,
          recipientUserId: notificationDeliveries.recipientUserId,
          payload: notificationDeliveries.payload,
        })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.scanId, recoveredScan.scanId),
            eq(notificationDeliveries.kind, "scan-recovery"),
          ),
        );

      expect(recoveryRows).toHaveLength(1);
      expect(recoveryRows[0]).toMatchObject({
        status: "pending",
        recipientUserId: fixture.ownerUserId,
        payload: {
          resolved: [
            {
              fingerprint: highFinding.fingerprint,
              severity: "high",
            },
          ],
        },
      });

      await dispatchSuccessfully(recoveredScan.scanId);

      const [resolvedIncident] = await db
        .select({
          active: recipientFindingIncidents.active,
          resolvedScanId: recipientFindingIncidents.resolvedScanId,
          resolvedAt: recipientFindingIncidents.resolvedAt,
        })
        .from(recipientFindingIncidents)
        .where(
          and(
            eq(
              recipientFindingIncidents.organizationId,
              fixture.organizationId,
            ),
            eq(recipientFindingIncidents.recipientUserId, fixture.ownerUserId),
          ),
        );

      expect(resolvedIncident?.active).toBe(false);
      expect(resolvedIncident?.resolvedScanId).toBe(recoveredScan.scanId);
      expect(resolvedIncident?.resolvedAt).toBeInstanceOf(Date);
    } finally {
      await cleanup(fixture);
    }
  });

  it("keeps the incident active on recovery send failure and does not enqueue duplicates", async () => {
    const fixture = await createFixture();

    try {
      const degradedScan = await createRunningScan(fixture);
      await completeScan(degradedScan, [highFinding]);
      await dispatchSuccessfully(degradedScan.scanId);

      const firstCleanScan = await createRunningScan(fixture);
      await completeScan(firstCleanScan, []);

      const result = await dispatchForScan(
        firstCleanScan.scanId,
        async (delivery) => {
          if (delivery.kind === "scan-recovery") {
            const error = new Error("SMTP unavailable") as Error & {
              code: string;
            };
            error.code = "ECONNREFUSED";
            throw error;
          }
        },
      );

      expect(result).toEqual({ attempted: 1, sent: 0, failed: 1 });

      const { db } = getDatabase();
      const [incidentAfterFailure] = await db
        .select({ active: recipientFindingIncidents.active })
        .from(recipientFindingIncidents)
        .where(
          and(
            eq(
              recipientFindingIncidents.organizationId,
              fixture.organizationId,
            ),
            eq(recipientFindingIncidents.recipientUserId, fixture.ownerUserId),
          ),
        );
      expect(incidentAfterFailure?.active).toBe(true);

      const secondCleanScan = await createRunningScan(fixture);
      await completeScan(secondCleanScan, []);

      const recoveryRows = await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.organizationId, fixture.organizationId),
            eq(notificationDeliveries.kind, "scan-recovery"),
          ),
        );
      expect(recoveryRows).toHaveLength(1);
    } finally {
      await cleanup(fixture);
    }
  });

  it("never creates a recovery for a degradation that was never delivered", async () => {
    const fixture = await createFixture();

    try {
      const degradedScan = await createRunningScan(fixture);
      await completeScan(degradedScan, [highFinding]);

      const cleanScan = await createRunningScan(fixture);
      await completeScan(cleanScan, []);

      const { db } = getDatabase();
      const incidents = await db
        .select({ id: recipientFindingIncidents.id })
        .from(recipientFindingIncidents)
        .where(
          eq(recipientFindingIncidents.organizationId, fixture.organizationId),
        );
      const recoveries = await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.organizationId, fixture.organizationId),
            eq(notificationDeliveries.kind, "scan-recovery"),
          ),
        );

      expect(incidents).toHaveLength(0);
      expect(recoveries).toHaveLength(0);
    } finally {
      await cleanup(fixture);
    }
  });

  it("isolates incidents and recoveries by recipient threshold", async () => {
    const fixture = await createFixture();

    try {
      const degradedScan = await createRunningScan(fixture);
      await completeScan(degradedScan, [highFinding]);
      await dispatchSuccessfully(degradedScan.scanId);

      const cleanScan = await createRunningScan(fixture);
      await completeScan(cleanScan, []);

      const { db } = getDatabase();
      const incidents = await db
        .select({
          recipientUserId: recipientFindingIncidents.recipientUserId,
        })
        .from(recipientFindingIncidents)
        .where(
          eq(recipientFindingIncidents.organizationId, fixture.organizationId),
        );
      const recoveries = await db
        .select({
          recipientUserId: notificationDeliveries.recipientUserId,
        })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.organizationId, fixture.organizationId),
            eq(notificationDeliveries.kind, "scan-recovery"),
          ),
        );

      expect(incidents).toEqual([{ recipientUserId: fixture.ownerUserId }]);
      expect(recoveries).toEqual([{ recipientUserId: fixture.ownerUserId }]);
      expect(fixture.adminUserId).not.toBe(fixture.ownerUserId);
    } finally {
      await cleanup(fixture);
    }
  });
});
