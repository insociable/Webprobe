import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { ScanResult } from "@agency-saas/contracts";
import {
  findings,
  memberships,
  notificationDeliveries,
  organizations,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import type { GeneratedFinding } from "../src/findings.js";
import type { HttpProbeResult } from "../src/http-probe.js";
import { persistScanCompletion } from "../src/scan-persistence.js";

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

function result(scanId: string, startedAt: Date): ScanResult {
  return {
    scanId,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    status: "completed",
    pagesVisited: 1,
    findings: [],
  };
}

function generatedFinding(severity: "medium" | "high"): GeneratedFinding {
  return {
    category: "availability",
    severity,
    code: "availability.http-5xx",
    title: "Le site retourne une erreur serveur",
    pageUrl: "https://example.com/",
    fingerprint: "a".repeat(64),
    evidence: { statusCode: 503 },
  };
}

async function createFixture(previousFindingSeverity?: "medium" | "high") {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const userId = randomUUID();
  const previousScanId = randomUUID();
  const currentScanId = randomUUID();

  await db.insert(users).values({
    id: userId,
    email: `alerts-${userId}@example.invalid`,
    displayName: "Alert owner",
    emailVerified: true,
  });
  await db.insert(organizations).values({
    id: organizationId,
    name: "Scan alert persistence test",
  });
  await db.insert(memberships).values({
    organizationId,
    userId,
    role: "owner",
  });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Alert target",
    canonicalUrl: "https://example.com/",
    status: "active",
    verifiedAt: new Date(),
  });
  await db.insert(scans).values([
    {
      id: previousScanId,
      organizationId,
      siteId,
      trigger: "manual",
      status: "completed",
      completedAt: new Date("2026-09-22T08:00:00.000Z"),
    },
    {
      id: currentScanId,
      organizationId,
      siteId,
      trigger: "manual",
      status: "running",
      startedAt: new Date("2026-09-22T09:00:00.000Z"),
    },
  ]);

  if (previousFindingSeverity) {
    await db.insert(findings).values({
      organizationId,
      scanId: previousScanId,
      category: "availability",
      severity: previousFindingSeverity,
      code: "availability.http-5xx",
      title: "Le site retourne une erreur serveur",
      pageUrl: "https://example.com/",
      fingerprint: "a".repeat(64),
      evidence: { statusCode: 503 },
    });
  }

  return {
    organizationId,
    siteId,
    userId,
    currentScanId,
    context: {
      scanId: currentScanId,
      organizationId,
      siteId,
      trigger: "manual" as const,
      scheduleId: null,
      scheduledFor: null,
      targetUrl: "https://example.com/",
      startedAt: new Date("2026-09-22T09:00:00.000Z"),
    },
  };
}

async function cleanup(organizationId: string, userId: string) {
  const { db } = getDatabase();
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(eq(users.id, userId));
}

describeDatabase("scan degradation notification creation", () => {
  it("creates one pending delivery for a new medium+ finding", async () => {
    const fixture = await createFixture();

    try {
      await persistScanCompletion(
        fixture.context,
        result(fixture.currentScanId, fixture.context.startedAt),
        successfulProbe(),
        [generatedFinding("high")],
      );

      const { db } = getDatabase();
      const rows = await db
        .select({
          status: notificationDeliveries.status,
          recipientUserId: notificationDeliveries.recipientUserId,
          payload: notificationDeliveries.payload,
        })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.organizationId, fixture.organizationId),
            eq(notificationDeliveries.scanId, fixture.currentScanId),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: "pending",
        recipientUserId: fixture.userId,
        payload: {
          degradations: [
            {
              change: "new",
              severity: "high",
              previousSeverity: null,
              fingerprint: "a".repeat(64),
            },
          ],
        },
      });
    } finally {
      await cleanup(fixture.organizationId, fixture.userId);
    }
  });

  it("does not create a delivery when the finding is unchanged", async () => {
    const fixture = await createFixture("high");

    try {
      await persistScanCompletion(
        fixture.context,
        result(fixture.currentScanId, fixture.context.startedAt),
        successfulProbe(),
        [generatedFinding("high")],
      );

      const { db } = getDatabase();
      const rows = await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.organizationId, fixture.organizationId),
            eq(notificationDeliveries.scanId, fixture.currentScanId),
          ),
        );

      expect(rows).toHaveLength(0);
    } finally {
      await cleanup(fixture.organizationId, fixture.userId);
    }
  });

  it("creates a delivery when an existing finding severity worsens", async () => {
    const fixture = await createFixture("medium");

    try {
      await persistScanCompletion(
        fixture.context,
        result(fixture.currentScanId, fixture.context.startedAt),
        successfulProbe(),
        [generatedFinding("high")],
      );

      const { db } = getDatabase();
      const [row] = await db
        .select({ payload: notificationDeliveries.payload })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.scanId, fixture.currentScanId));

      expect(row?.payload).toMatchObject({
        degradations: [
          {
            change: "worsened",
            severity: "high",
            previousSeverity: "medium",
          },
        ],
      });
    } finally {
      await cleanup(fixture.organizationId, fixture.userId);
    }
  });
});
