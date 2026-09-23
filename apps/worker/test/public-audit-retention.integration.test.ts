import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  organizations,
  reportShares,
  scanArtifacts,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { eq, inArray } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import { purgeExpiredPublicAudits } from "../src/public-audit-retention.js";
import {
  persistPrimaryScreenshot,
  primaryScreenshotStorageKey,
} from "../src/scan-artifacts.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

afterAll(async () => {
  await closeDatabase();
});

async function createFixture() {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const userId = randomUUID();

  await db.insert(users).values({
    id: userId,
    email: `retention-${userId}@example.test`,
    displayName: "Retention test",
    emailVerified: true,
  });
  await db.insert(organizations).values({
    id: organizationId,
    name: "Public audit retention test",
  });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Retention target",
    canonicalUrl: "https://example.com/",
    status: "active",
    verifiedAt: new Date(),
  });

  return { organizationId, siteId, userId };
}

async function cleanupFixture(organizationId: string, userId: string) {
  const { db } = getDatabase();
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(eq(users.id, userId));
}

describeDatabase("public audit retention", () => {
  it("purges expired public audits and files while preserving monitoring and active shares", async () => {
    const { db } = getDatabase();
    const fixture = await createFixture();
    const root = await mkdtemp(path.join(os.tmpdir(), "agency-retention-"));
    const previousRoot = process.env.SCAN_ARTIFACTS_DIR;
    process.env.SCAN_ARTIFACTS_DIR = root;
    const now = new Date("2026-09-23T10:00:00.000Z");
    const oldCompletedAt = new Date("2026-05-01T10:00:00.000Z");
    const recentCompletedAt = new Date("2026-09-01T10:00:00.000Z");
    const purgeId = randomUUID();
    const sharedId = randomUUID();
    const monitoringId = randomUUID();
    const recentId = randomUUID();

    try {
      await db.insert(scans).values([
        {
          id: purgeId,
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          trigger: "manual",
          scanMode: "public_audit",
          status: "completed",
          completedAt: oldCompletedAt,
        },
        {
          id: sharedId,
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          trigger: "manual",
          scanMode: "public_audit",
          status: "completed",
          completedAt: oldCompletedAt,
        },
        {
          id: monitoringId,
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          trigger: "manual",
          scanMode: "verified_monitoring",
          status: "completed",
          completedAt: oldCompletedAt,
        },
        {
          id: recentId,
          organizationId: fixture.organizationId,
          siteId: fixture.siteId,
          trigger: "manual",
          scanMode: "public_audit",
          status: "completed",
          completedAt: recentCompletedAt,
        },
      ]);

      await persistPrimaryScreenshot({
        organizationId: fixture.organizationId,
        siteId: fixture.siteId,
        scanId: purgeId,
        screenshot: {
          data: Buffer.from("retention-jpeg"),
          mediaType: "image/jpeg",
        },
      });

      await db.insert(reportShares).values({
        organizationId: fixture.organizationId,
        siteId: fixture.siteId,
        scanId: sharedId,
        tokenHash: "a".repeat(64),
        tokenCiphertext: "retention-test-ciphertext",
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        createdByUserId: fixture.userId,
        createdAt: new Date(now.getTime() - 60 * 1000),
      });

      const result = await purgeExpiredPublicAudits(now, {
        retentionDays: 90,
        batchSize: 100,
        intervalMs: 60_000,
      });

      expect(result).toEqual({
        checked: 2,
        purged: 1,
        skippedActiveShare: 1,
        artifactFailures: 0,
        alreadyGone: 0,
      });

      const remaining = await db
        .select({ id: scans.id })
        .from(scans)
        .where(inArray(scans.id, [purgeId, sharedId, monitoringId, recentId]));
      expect(remaining.map((row) => row.id).sort()).toEqual(
        [sharedId, monitoringId, recentId].sort(),
      );

      const metadata = await db
        .select({ id: scanArtifacts.id })
        .from(scanArtifacts)
        .where(eq(scanArtifacts.scanId, purgeId));
      expect(metadata).toHaveLength(0);

      const storageKey = primaryScreenshotStorageKey({
        organizationId: fixture.organizationId,
        siteId: fixture.siteId,
        scanId: purgeId,
      });
      await expect(
        access(path.resolve(root, ...storageKey.split("/"))),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousRoot === undefined) delete process.env.SCAN_ARTIFACTS_DIR;
      else process.env.SCAN_ARTIFACTS_DIR = previousRoot;
      await cleanupFixture(fixture.organizationId, fixture.userId);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when retained artifact metadata is unsafe", async () => {
    const { db } = getDatabase();
    const fixture = await createFixture();
    const oldId = randomUUID();
    const now = new Date("2026-09-23T10:00:00.000Z");

    try {
      await db.insert(scans).values({
        id: oldId,
        organizationId: fixture.organizationId,
        siteId: fixture.siteId,
        trigger: "manual",
        scanMode: "public_audit",
        status: "completed",
        completedAt: new Date("2026-05-01T10:00:00.000Z"),
      });
      await db.insert(scanArtifacts).values({
        organizationId: fixture.organizationId,
        siteId: fixture.siteId,
        scanId: oldId,
        kind: "primary-screenshot",
        storageKey: "../outside.jpg",
        mediaType: "image/jpeg",
        byteSize: 1,
        sha256: "b".repeat(64),
      });

      const result = await purgeExpiredPublicAudits(now, {
        retentionDays: 90,
        batchSize: 100,
        intervalMs: 60_000,
      });

      expect(result).toMatchObject({
        checked: 1,
        purged: 0,
        artifactFailures: 1,
      });
      const [persisted] = await db
        .select({ id: scans.id })
        .from(scans)
        .where(eq(scans.id, oldId));
      expect(persisted?.id).toBe(oldId);
    } finally {
      await cleanupFixture(fixture.organizationId, fixture.userId);
    }
  });
});
