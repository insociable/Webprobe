import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { organizations, scanAttempts, scans, sites } from "@agency-saas/db";
import { asc, eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import {
  beginScanAttempt,
  completeScanAttempt,
  failScanAttempt,
  getScanAttemptCount,
} from "../src/scan-retry.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

afterAll(async () => {
  await closeDatabase();
});

describeDatabase("scan attempt history", () => {
  it("preserves retry and completion attempts in order", async () => {
    const { db } = getDatabase();
    const organizationId = randomUUID();
    const siteId = randomUUID();

    await db.insert(organizations).values({
      id: organizationId,
      name: "Attempt history test",
    });
    await db.insert(sites).values({
      id: siteId,
      organizationId,
      name: "Attempt target",
      canonicalUrl: "https://example.com/",
      status: "active",
      verifiedAt: new Date(),
    });
    const [scan] = await db
      .insert(scans)
      .values({
        organizationId,
        siteId,
        trigger: "manual",
        status: "running",
        startedAt: new Date(),
      })
      .returning({ id: scans.id });
    if (!scan) throw new Error("fixture scan creation failed");

    try {
      const first = await beginScanAttempt(scan.id);
      await failScanAttempt(
        first,
        { retryable: true, code: "ECONNRESET" },
        false,
      );

      const second = await beginScanAttempt(scan.id);
      await completeScanAttempt(second);

      expect(await getScanAttemptCount(scan.id)).toBe(2);

      const history = await db
        .select({
          attemptNumber: scanAttempts.attemptNumber,
          status: scanAttempts.status,
          retryable: scanAttempts.retryable,
          errorCode: scanAttempts.errorCode,
        })
        .from(scanAttempts)
        .where(eq(scanAttempts.scanId, scan.id))
        .orderBy(asc(scanAttempts.attemptNumber));

      expect(history).toEqual([
        {
          attemptNumber: 1,
          status: "retrying",
          retryable: true,
          errorCode: "ECONNRESET",
        },
        {
          attemptNumber: 2,
          status: "completed",
          retryable: false,
          errorCode: null,
        },
      ]);
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  });

  it("closes an interrupted running attempt before recording its replay", async () => {
    const { db } = getDatabase();
    const organizationId = randomUUID();
    const siteId = randomUUID();

    await db.insert(organizations).values({
      id: organizationId,
      name: "Interrupted attempt test",
    });
    await db.insert(sites).values({
      id: siteId,
      organizationId,
      name: "Interrupted target",
      canonicalUrl: "https://example.org/",
      status: "active",
      verifiedAt: new Date(),
    });
    const [scan] = await db
      .insert(scans)
      .values({
        organizationId,
        siteId,
        trigger: "manual",
        status: "running",
        startedAt: new Date(),
      })
      .returning({ id: scans.id });
    if (!scan) throw new Error("fixture scan creation failed");

    try {
      const first = await beginScanAttempt(scan.id);
      const replay = await beginScanAttempt(scan.id);

      expect(replay.attemptNumber).toBe(2);

      const history = await db
        .select({
          attemptNumber: scanAttempts.attemptNumber,
          status: scanAttempts.status,
          retryable: scanAttempts.retryable,
          errorCode: scanAttempts.errorCode,
        })
        .from(scanAttempts)
        .where(eq(scanAttempts.scanId, scan.id))
        .orderBy(asc(scanAttempts.attemptNumber));

      expect(history).toEqual([
        {
          attemptNumber: 1,
          status: "retrying",
          retryable: true,
          errorCode: "worker-interrupted",
        },
        {
          attemptNumber: 2,
          status: "running",
          retryable: false,
          errorCode: null,
        },
      ]);

      await completeScanAttempt(replay);
      expect(first.attemptNumber).toBe(1);
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  });
});
