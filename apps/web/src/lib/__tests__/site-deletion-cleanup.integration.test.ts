import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  artifactCleanupTasks,
  memberships,
  organizations,
  scanArtifacts,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { db } from "../database";
import { deleteSiteForOrganization } from "../site-deletion-service";
import { getPrimaryScreenshotArtifact } from "../scan-artifact-service";
import { persistPrimaryScreenshot } from "../../../../worker/src/scan-artifacts.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

async function withFixture(
  run: (fixture: {
    userId: string;
    organizationId: string;
    siteId: string;
    scanId: string;
    storageKey: string;
  }) => Promise<void>,
) {
  const userId = randomUUID(),
    organizationId = randomUUID(),
    siteId = randomUUID(),
    scanId = randomUUID();
  const storageKey = `${organizationId}/${siteId}/${scanId}/primary.jpg`;
  try {
    await db.insert(users).values({
      id: userId,
      email: `cleanup-${userId}@example.invalid`,
      displayName: "Cleanup owner",
    });
    await db
      .insert(organizations)
      .values({ id: organizationId, name: "Deletion cleanup test" });
    await db
      .insert(memberships)
      .values({ userId, organizationId, role: "owner" });
    await db.insert(sites).values({
      id: siteId,
      organizationId,
      name: "Cleanup test site",
      canonicalUrl: "https://cleanup.example.invalid/",
    });
    await db.insert(scans).values({
      id: scanId,
      organizationId,
      siteId,
      trigger: "manual",
      status: "completed",
    });
    await db.insert(scanArtifacts).values({
      organizationId,
      siteId,
      scanId,
      storageKey,
      kind: "primary-screenshot",
      mediaType: "image/jpeg",
      byteSize: 10,
      sha256: "a".repeat(64),
    });
    await run({ userId, organizationId, siteId, scanId, storageKey });
  } finally {
    await db
      .delete(artifactCleanupTasks)
      .where(eq(artifactCleanupTasks.storageKey, storageKey));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    await db.delete(users).where(eq(users.id, userId));
  }
}

describeDatabase("site deletion cleanup outbox", () => {
  it("commits cleanup with the deletion and revokes screenshot access immediately", async () => {
    await withFixture(
      async ({ userId, organizationId, siteId, scanId, storageKey }) => {
        expect(
          await deleteSiteForOrganization(userId, organizationId, siteId),
        ).toEqual({ deleted: true, artifactCleanupPending: 1 });
        expect(
          await db.select().from(sites).where(eq(sites.id, siteId)),
        ).toHaveLength(0);
        expect(
          await db.select().from(scans).where(eq(scans.id, scanId)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(scanArtifacts)
            .where(eq(scanArtifacts.scanId, scanId)),
        ).toHaveLength(0);
        const tasks = await db
          .select()
          .from(artifactCleanupTasks)
          .where(eq(artifactCleanupTasks.storageKey, storageKey));
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
          storageKey,
          attempts: 0,
          lastErrorCode: null,
        });
        expect(
          await getPrimaryScreenshotArtifact(
            userId,
            organizationId,
            siteId,
            scanId,
          ),
        ).toBeNull();
      },
    );
  });

  it("fences a capture after deletion wins the finalization-to-capture gap", async () => {
    await withFixture(
      async ({ userId, organizationId, siteId, scanId, storageKey }) => {
        const root = await mkdtemp(
          path.join(os.tmpdir(), "webprobe-delete-gap-"),
        );
        const previousRoot = process.env.SCAN_ARTIFACTS_DIR;
        process.env.SCAN_ARTIFACTS_DIR = root;

        try {
          await deleteSiteForOrganization(userId, organizationId, siteId);
          await expect(
            persistPrimaryScreenshot({
              organizationId,
              siteId,
              scanId,
              screenshot: {
                data: Buffer.from("must-not-be-written-after-delete"),
                mediaType: "image/jpeg",
              },
            }),
          ).resolves.toBe(false);
          await expect(
            access(path.join(root, ...storageKey.split("/"))),
          ).rejects.toMatchObject({ code: "ENOENT" });
          expect(
            await db
              .select()
              .from(scanArtifacts)
              .where(eq(scanArtifacts.scanId, scanId)),
          ).toHaveLength(0);
        } finally {
          if (previousRoot === undefined) delete process.env.SCAN_ARTIFACTS_DIR;
          else process.env.SCAN_ARTIFACTS_DIR = previousRoot;
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  });

  it("makes site deletion wait for a capture holding the site fence", async () => {
    await withFixture(
      async ({ userId, organizationId, siteId, scanId, storageKey }) => {
        const root = await mkdtemp(
          path.join(os.tmpdir(), "webprobe-delete-race-"),
        );
        const previousRoot = process.env.SCAN_ARTIFACTS_DIR;
        process.env.SCAN_ARTIFACTS_DIR = root;
        let markEntered: () => void = () => {};
        let continueWrite: () => void = () => {};
        const entered = new Promise<void>((resolve) => {
          markEntered = resolve;
        });
        const resume = new Promise<void>((resolve) => {
          continueWrite = resolve;
        });

        try {
          const screenshot = persistPrimaryScreenshot(
            {
              organizationId,
              siteId,
              scanId,
              screenshot: {
                data: Buffer.from("capture-before-delete"),
                mediaType: "image/jpeg",
              },
            },
            {
              afterRename: async () => {
                markEntered();
                await resume;
              },
            },
          );
          await entered;

          let deletionFinished = false;
          const deletion = deleteSiteForOrganization(
            userId,
            organizationId,
            siteId,
          ).then((result) => {
            deletionFinished = true;
            return result;
          });
          await new Promise((resolve) => setTimeout(resolve, 30));
          expect(deletionFinished).toBe(false);

          continueWrite();
          await expect(screenshot).resolves.toBe(true);
          await expect(deletion).resolves.toEqual({
            deleted: true,
            artifactCleanupPending: 1,
          });
          expect(
            await getPrimaryScreenshotArtifact(
              userId,
              organizationId,
              siteId,
              scanId,
            ),
          ).toBeNull();
          const [task] = await db
            .select()
            .from(artifactCleanupTasks)
            .where(eq(artifactCleanupTasks.storageKey, storageKey));
          expect(task?.action).toBe("delete");
          await expect(
            access(path.join(root, ...storageKey.split("/"))),
          ).resolves.toBeUndefined();
        } finally {
          continueWrite();
          if (previousRoot === undefined) delete process.env.SCAN_ARTIFACTS_DIR;
          else process.env.SCAN_ARTIFACTS_DIR = previousRoot;
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  });

  it("rolls back site deletion and all cleanup work if an artifact belongs to another tenant", async () => {
    await withFixture(
      async ({ userId, organizationId, siteId, scanId, storageKey }) => {
        await db
          .update(scanArtifacts)
          .set({
            storageKey: `${randomUUID()}/${siteId}/${scanId}/primary.jpg`,
          })
          .where(eq(scanArtifacts.scanId, scanId));
        await expect(
          deleteSiteForOrganization(userId, organizationId, siteId),
        ).rejects.toMatchObject({ code: "artifact-invalid" });
        expect(
          await db.select().from(sites).where(eq(sites.id, siteId)),
        ).toHaveLength(1);
        expect(
          await db.select().from(scans).where(eq(scans.id, scanId)),
        ).toHaveLength(1);
        expect(
          await db
            .select()
            .from(artifactCleanupTasks)
            .where(eq(artifactCleanupTasks.storageKey, storageKey)),
        ).toHaveLength(0);
      },
    );
  });
});
