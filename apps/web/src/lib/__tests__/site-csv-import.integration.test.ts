import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  memberships,
  organizations,
  siteImportEvents,
  sites,
  users,
} from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { db } from "../database";
import { confirmSiteImport, previewSiteImport } from "../site-csv-import";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("CSV import isolation and atomicity", () => {
  it("previews existing sites and inserts only permitted rows without scans", async () => {
    const owner = randomUUID(),
      outsider = randomUUID();
    const org = randomUUID(),
      otherOrg = randomUUID();
    const existing = randomUUID();
    await db.insert(users).values([
      {
        id: owner,
        email: `csv-owner-${owner}@example.invalid`,
        displayName: "Owner",
      },
      {
        id: outsider,
        email: `csv-other-${outsider}@example.invalid`,
        displayName: "Other",
      },
    ]);
    try {
      await db.insert(organizations).values([
        { id: org, name: "CSV Org" },
        { id: otherOrg, name: "Other Org" },
      ]);
      await db.insert(memberships).values([
        { organizationId: org, userId: owner, role: "owner" },
        { organizationId: otherOrg, userId: outsider, role: "owner" },
      ]);
      await db.insert(sites).values({
        id: existing,
        organizationId: org,
        name: "Existing",
        canonicalUrl: "https://existing.example/",
      });
      const csv =
        "url,name\nhttps://existing.example/,Old\nhttps://new.example/,New\nhttps://new.example,Duplicate\n";
      const rows = await previewSiteImport(owner, org, csv);
      expect(rows.map((row) => row.status)).toEqual([
        "existing",
        "ready",
        "duplicate-file",
      ]);
      await expect(confirmSiteImport(outsider, org, csv)).rejects.toThrow();
      await expect(
        confirmSiteImport(
          owner,
          org,
          "url,name\nhttps://valid.example,Good\nfile:///etc/passwd,Bad",
        ),
      ).rejects.toThrow();
      expect(
        (await db.select().from(sites).where(eq(sites.organizationId, org)))
          .length,
      ).toBe(1);
      expect(await confirmSiteImport(owner, org, csv)).toEqual({
        imported: 1,
        skipped: 2,
      });
      expect(
        (await db.select().from(sites).where(eq(sites.organizationId, org)))
          .length,
      ).toBe(2);
      const [event] = await db
        .select()
        .from(siteImportEvents)
        .where(
          and(
            eq(siteImportEvents.organizationId, org),
            eq(siteImportEvents.actorUserId, owner),
          ),
        );
      expect(event?.importedCount).toBe(1);
    } finally {
      await db.delete(organizations).where(eq(organizations.id, org));
      await db.delete(organizations).where(eq(organizations.id, otherOrg));
      await db.delete(users).where(eq(users.id, owner));
      await db.delete(users).where(eq(users.id, outsider));
    }
  });
});
