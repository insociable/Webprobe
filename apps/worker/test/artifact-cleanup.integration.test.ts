import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  artifactCleanupTasks,
  organizations,
  scanArtifacts,
  scans,
  sites,
} from "@agency-saas/db";
import { eq, inArray } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import { purgePendingArtifacts } from "../src/artifact-cleanup.js";
import {
  artifactWriteGraceMs,
  persistPrimaryScreenshot,
  primaryScreenshotStorageKey,
} from "../src/scan-artifacts.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
afterAll(async () => {
  await closeDatabase();
});

async function withFixture(
  run: (fixture: {
    root: string;
    storageKey: string;
    filePath: string;
    organizationId: string;
    siteId: string;
    scanId: string;
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "webprobe-cleanup-"));
  const previousRoot = process.env.SCAN_ARTIFACTS_DIR;
  process.env.SCAN_ARTIFACTS_DIR = root;
  const ids = {
    organizationId: randomUUID(),
    siteId: randomUUID(),
    scanId: randomUUID(),
  };
  const storageKey = primaryScreenshotStorageKey(ids);
  const filePath = path.join(root, ...storageKey.split("/"));
  try {
    await run({ root, storageKey, filePath, ...ids });
  } finally {
    const { db } = getDatabase();
    await db
      .delete(artifactCleanupTasks)
      .where(eq(artifactCleanupTasks.storageKey, storageKey));
    await db
      .delete(organizations)
      .where(eq(organizations.id, ids.organizationId));
    if (previousRoot === undefined) delete process.env.SCAN_ARTIFACTS_DIR;
    else process.env.SCAN_ARTIFACTS_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
}

describeDatabase("durable artifact cleanup", () => {
  it("retains a failed unlink, backs off, and resumes after a worker restart", async () => {
    await withFixture(async ({ storageKey, filePath }) => {
      const now = new Date();
      await mkdir(filePath, { recursive: true }); // Unexpected directory at the file path.
      await getDatabase()
        .db.insert(artifactCleanupTasks)
        .values({
          storageKey,
          nextAttemptAt: now,
          createdAt: new Date(now.getTime() - 25 * 60 * 60_000),
        });
      expect(await purgePendingArtifacts(now)).toMatchObject({
        checked: 1,
        removed: 0,
        retried: 1,
        pending: 1,
        oldestPendingAgeMs: 25 * 60 * 60_000,
      });
      const [task] = await getDatabase()
        .db.select()
        .from(artifactCleanupTasks)
        .where(eq(artifactCleanupTasks.storageKey, storageKey));
      expect(task).toMatchObject({
        attempts: 1,
        lastErrorCode: "unsafe-storage-key",
      });
      expect(task!.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);
      expect(
        await purgePendingArtifacts(new Date(now.getTime() + 30_000)),
      ).toMatchObject({ checked: 0, pending: 1 });
      await rm(filePath, { recursive: true });
      await writeFile(filePath, "orphaned-jpeg");
      await closeDatabase(); // No in-memory retry state survives.
      expect(
        await purgePendingArtifacts(new Date(now.getTime() + 61_000)),
      ).toMatchObject({ checked: 1, removed: 1, retried: 0, pending: 0 });
      await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        await purgePendingArtifacts(new Date(now.getTime() + 62_000)),
      ).toMatchObject({ checked: 0, removed: 0 });
    });
  });

  it("acknowledges an already removed file and divides concurrent work without losing tasks", async () => {
    await withFixture(async ({ root, storageKey }) => {
      const keys = [
        storageKey,
        ...Array.from({ length: 7 }, () =>
          primaryScreenshotStorageKey({
            organizationId: randomUUID(),
            siteId: randomUUID(),
            scanId: randomUUID(),
          }),
        ),
      ];
      const now = new Date();
      try {
        for (const key of keys.slice(1)) {
          const file = path.join(root, ...key.split("/"));
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, "cleanup-concurrency");
        }
        await getDatabase()
          .db.insert(artifactCleanupTasks)
          .values(keys.map((key) => ({ storageKey: key, nextAttemptAt: now })));
        const results = await Promise.all([
          purgePendingArtifacts(now, 4),
          purgePendingArtifacts(now, 4),
        ]);
        expect(
          results.reduce((total, result) => total + result.checked, 0),
        ).toBe(8);
        expect(
          results.reduce((total, result) => total + result.removed, 0),
        ).toBe(8);
        expect(
          results.reduce((total, result) => total + result.retried, 0),
        ).toBe(0);
        expect(
          await getDatabase()
            .db.select()
            .from(artifactCleanupTasks)
            .where(inArray(artifactCleanupTasks.storageKey, keys)),
        ).toHaveLength(0);
        for (const key of keys)
          await expect(
            access(path.join(root, ...key.split("/"))),
          ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await getDatabase()
          .db.delete(artifactCleanupTasks)
          .where(inArray(artifactCleanupTasks.storageKey, keys));
      }
    });
  });

  it("recovers a renamed screenshot when metadata persistence fails", async () => {
    await withFixture(async (fixture) => {
      const { db } = getDatabase();
      await db
        .insert(organizations)
        .values({ id: fixture.organizationId, name: "Cleanup write intent" });
      await db.insert(sites).values({
        id: fixture.siteId,
        organizationId: fixture.organizationId,
        name: "Write intent site",
        canonicalUrl: "https://cleanup.example.invalid/",
      });
      await db.insert(scans).values({
        id: fixture.scanId,
        organizationId: fixture.organizationId,
        siteId: fixture.siteId,
        trigger: "manual",
        status: "completed",
      });

      await expect(
        persistPrimaryScreenshot(
          {
            ...fixture,
            screenshot: {
              data: Buffer.from("renamed-but-unregistered"),
              mediaType: "image/jpeg",
            },
          },
          {
            afterRename: async () => {
              throw new Error("simulated metadata insert failure");
            },
          },
        ),
      ).rejects.toThrow("simulated metadata insert failure");

      expect((await readFile(fixture.filePath)).toString()).toBe(
        "renamed-but-unregistered",
      );
      expect(
        await db
          .select()
          .from(scanArtifacts)
          .where(eq(scanArtifacts.scanId, fixture.scanId)),
      ).toHaveLength(0);
      const [intent] = await db
        .select()
        .from(artifactCleanupTasks)
        .where(eq(artifactCleanupTasks.storageKey, fixture.storageKey));
      expect(intent).toMatchObject({
        action: "write_intent",
        organizationId: fixture.organizationId,
        siteId: fixture.siteId,
        scanId: fixture.scanId,
      });

      const cleanupAt = new Date(Date.now() + artifactWriteGraceMs + 1);
      expect(await purgePendingArtifacts(cleanupAt)).toMatchObject({
        checked: 1,
        removed: 1,
        pending: 0,
      });
      await expect(access(fixture.filePath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("does not remove an artifact still referenced by a live site", async () => {
    await withFixture(async (fixture) => {
      const { db } = getDatabase();
      await db
        .insert(organizations)
        .values({ id: fixture.organizationId, name: "Cleanup live reference" });
      await db.insert(sites).values({
        id: fixture.siteId,
        organizationId: fixture.organizationId,
        name: "Live artifact",
        canonicalUrl: "https://cleanup.example.invalid/",
      });
      await db.insert(scans).values({
        id: fixture.scanId,
        organizationId: fixture.organizationId,
        siteId: fixture.siteId,
        trigger: "manual",
        status: "completed",
      });
      await persistPrimaryScreenshot({
        ...fixture,
        screenshot: { data: Buffer.from("live-jpeg"), mediaType: "image/jpeg" },
      });
      const now = new Date();
      await db
        .insert(artifactCleanupTasks)
        .values({ storageKey: fixture.storageKey, nextAttemptAt: now });
      expect(await purgePendingArtifacts(now)).toMatchObject({
        removed: 0,
        retried: 1,
      });
      expect((await readFile(fixture.filePath)).toString()).toBe("live-jpeg");
      const [task] = await db
        .select()
        .from(artifactCleanupTasks)
        .where(eq(artifactCleanupTasks.storageKey, fixture.storageKey));
      expect(task?.lastErrorCode).toBe("still-referenced");
      await db.delete(sites).where(eq(sites.id, fixture.siteId));
      expect(
        await db
          .select()
          .from(scanArtifacts)
          .where(eq(scanArtifacts.scanId, fixture.scanId)),
      ).toHaveLength(0);
      expect(
        await purgePendingArtifacts(new Date(now.getTime() + 61_000)),
      ).toMatchObject({ removed: 1, pending: 0 });
    });
  });

  it("rejects traversal keys and refuses symlinked directories outside storage", async () => {
    await withFixture(async ({ root, storageKey, organizationId }) => {
      const { db } = getDatabase();
      await expect(
        db
          .insert(artifactCleanupTasks)
          .values({ storageKey: "../outside/primary.jpg" }),
      ).rejects.toThrow();
      const outside = await mkdtemp(
        path.join(os.tmpdir(), "webprobe-cleanup-outside-"),
      );
      const segments = storageKey.split("/");
      const outsideFile = path.join(outside, ...segments.slice(1));
      try {
        await mkdir(path.dirname(outsideFile), { recursive: true });
        await writeFile(outsideFile, "must-stay");
        await symlink(outside, path.join(root, organizationId), "dir");
        const now = new Date();
        await db
          .insert(artifactCleanupTasks)
          .values({ storageKey, nextAttemptAt: now });
        expect(await purgePendingArtifacts(now)).toMatchObject({
          removed: 0,
          retried: 1,
        });
        expect((await readFile(outsideFile)).toString()).toBe("must-stay");
        const [task] = await db
          .select()
          .from(artifactCleanupTasks)
          .where(eq(artifactCleanupTasks.storageKey, storageKey));
        expect(task?.lastErrorCode).toBe("unsafe-storage-key");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });
});
