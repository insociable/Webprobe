import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  memberships,
  organizations,
  scanArtifacts,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { db } from "../database";
import {
  getPrimaryScreenshotArtifact,
  readPrimaryScreenshot,
} from "../scan-artifact-service";
import { OrganizationAccessError } from "../organization-site-service";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("scan artifact tenant access", () => {
  it("serves only an authorized, intact screenshot artifact", async () => {
    const ownerId = randomUUID();
    const outsiderId = randomUUID();
    const organizationId = randomUUID();
    const outsiderOrganizationId = randomUUID();
    const siteId = randomUUID();
    const scanId = randomUUID();
    const root = await mkdtemp(path.join(os.tmpdir(), "agency-web-artifacts-"));
    const previousRoot = process.env.SCAN_ARTIFACTS_DIR;
    process.env.SCAN_ARTIFACTS_DIR = root;

    const storageKey = `${organizationId}/${siteId}/${scanId}/primary.jpg`;
    const bytes = Buffer.from("authorized-jpeg");
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    try {
      await db.insert(users).values([
        {
          id: ownerId,
          email: `artifact-owner-${ownerId}@example.invalid`,
          displayName: "Artifact owner",
        },
        {
          id: outsiderId,
          email: `artifact-outsider-${outsiderId}@example.invalid`,
          displayName: "Artifact outsider",
        },
      ]);
      await db.insert(organizations).values([
        { id: organizationId, name: "Artifact organization" },
        { id: outsiderOrganizationId, name: "Outsider organization" },
      ]);
      await db.insert(memberships).values([
        { organizationId, userId: ownerId, role: "owner" },
        {
          organizationId: outsiderOrganizationId,
          userId: outsiderId,
          role: "owner",
        },
      ]);
      await db.insert(sites).values({
        id: siteId,
        organizationId,
        name: "Artifact site",
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
      await db.insert(scanArtifacts).values({
        organizationId,
        siteId,
        scanId,
        kind: "primary-screenshot",
        storageKey,
        mediaType: "image/jpeg",
        byteSize: bytes.length,
        sha256,
      });

      const filePath = path.resolve(root, ...storageKey.split("/"));
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes);

      const artifact = await getPrimaryScreenshotArtifact(
        ownerId,
        organizationId,
        siteId,
        scanId,
      );
      expect(artifact).toMatchObject({
        storageKey,
        mediaType: "image/jpeg",
        byteSize: bytes.length,
        sha256,
      });
      expect((await readPrimaryScreenshot(artifact!))?.equals(bytes)).toBe(
        true,
      );

      await expect(
        getPrimaryScreenshotArtifact(
          outsiderId,
          organizationId,
          siteId,
          scanId,
        ),
      ).rejects.toBeInstanceOf(OrganizationAccessError);

      await writeFile(filePath, Buffer.from("tampered"));
      expect(await readPrimaryScreenshot(artifact!)).toBeNull();
    } finally {
      if (previousRoot === undefined) {
        delete process.env.SCAN_ARTIFACTS_DIR;
      } else {
        process.env.SCAN_ARTIFACTS_DIR = previousRoot;
      }
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await db
        .delete(organizations)
        .where(eq(organizations.id, outsiderOrganizationId));
      await db.delete(users).where(eq(users.id, ownerId));
      await db.delete(users).where(eq(users.id, outsiderId));
      await rm(root, { recursive: true, force: true });
    }
  });
});
