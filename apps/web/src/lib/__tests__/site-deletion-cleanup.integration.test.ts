import { randomUUID } from "node:crypto";
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
