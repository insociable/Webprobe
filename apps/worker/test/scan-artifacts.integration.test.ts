import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { organizations, scanArtifacts, scans, sites } from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
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
  const scanId = randomUUID();

  await db.insert(organizations).values({
    id: organizationId,
    name: "Screenshot artifact integration",
  });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Artifact target",
    canonicalUrl: "https://example.com/",
    status: "active",
    verifiedAt: new Date(),
  });
  await db.insert(scans).values({
    id: scanId,
    organizationId,
    siteId,
    trigger: "manual",
    status: "completed",
    completedAt: new Date(),
  });

  return { organizationId, siteId, scanId };
}

describeDatabase("scan screenshot artifact persistence", () => {
  it("stores JPEG bytes outside PostgreSQL and upserts metadata idempotently", async () => {
    const fixture = await createFixture();
    const root = await mkdtemp(path.join(os.tmpdir(), "agency-artifacts-"));
    const previousRoot = process.env.SCAN_ARTIFACTS_DIR;
    process.env.SCAN_ARTIFACTS_DIR = root;

    try {
      const first = Buffer.from("first-jpeg");
      const second = Buffer.from("second-jpeg");

      await expect(
        persistPrimaryScreenshot({
          ...fixture,
          screenshot: { data: first, mediaType: "image/jpeg" },
        }),
      ).resolves.toBe(true);

      await expect(
        persistPrimaryScreenshot({
          ...fixture,
          screenshot: { data: second, mediaType: "image/jpeg" },
        }),
      ).resolves.toBe(true);

      const storageKey = primaryScreenshotStorageKey(fixture);
      const stored = await readFile(
        path.resolve(root, ...storageKey.split("/")),
      );
      expect(stored.equals(second)).toBe(true);

      const { db } = getDatabase();
      const rows = await db
        .select({
          storageKey: scanArtifacts.storageKey,
          mediaType: scanArtifacts.mediaType,
          byteSize: scanArtifacts.byteSize,
          sha256: scanArtifacts.sha256,
        })
        .from(scanArtifacts)
        .where(eq(scanArtifacts.scanId, fixture.scanId));

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        storageKey,
        mediaType: "image/jpeg",
        byteSize: second.length,
      });
      expect(rows[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.SCAN_ARTIFACTS_DIR;
      } else {
        process.env.SCAN_ARTIFACTS_DIR = previousRoot;
      }
      const { db } = getDatabase();
      await db
        .delete(organizations)
        .where(eq(organizations.id, fixture.organizationId));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects oversized screenshot payloads before writing metadata", async () => {
    const fixture = await createFixture();

    try {
      const result = await persistPrimaryScreenshot({
        ...fixture,
        screenshot: {
          data: Buffer.alloc(2 * 1024 * 1024 + 1),
          mediaType: "image/jpeg",
        },
      });
      expect(result).toBe(false);

      const { db } = getDatabase();
      const rows = await db
        .select({ id: scanArtifacts.id })
        .from(scanArtifacts)
        .where(eq(scanArtifacts.scanId, fixture.scanId));
      expect(rows).toHaveLength(0);
    } finally {
      const { db } = getDatabase();
      await db
        .delete(organizations)
        .where(eq(organizations.id, fixture.organizationId));
    }
  });
});
