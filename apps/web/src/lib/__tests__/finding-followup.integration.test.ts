import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  findingRemediationEvents,
  findings,
  memberships,
  organizations,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { db } from "../database";
import {
  getFindingFollowups,
  updateFindingFollowup,
} from "../finding-followup";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("finding followup access and history", () => {
  it("records status changes and rejects foreign assignees or unjustified risk acceptance", async () => {
    const owner = randomUUID(),
      member = randomUUID(),
      foreign = randomUUID();
    const org = randomUUID(),
      foreignOrg = randomUUID(),
      site = randomUUID(),
      scan = randomUUID();
    const fingerprint = "f".repeat(64);
    await db.insert(users).values([
      {
        id: owner,
        email: `followup-owner-${owner}@example.invalid`,
        displayName: "Owner",
      },
      {
        id: member,
        email: `followup-member-${member}@example.invalid`,
        displayName: "Member",
      },
      {
        id: foreign,
        email: `followup-other-${foreign}@example.invalid`,
        displayName: "Other",
      },
    ]);
    try {
      await db.insert(organizations).values([
        { id: org, name: "Followup Org" },
        { id: foreignOrg, name: "Foreign Org" },
      ]);
      await db.insert(memberships).values([
        { organizationId: org, userId: owner, role: "owner" },
        { organizationId: org, userId: member, role: "member" },
        { organizationId: foreignOrg, userId: foreign, role: "owner" },
      ]);
      await db.insert(sites).values({
        id: site,
        organizationId: org,
        name: "Site",
        canonicalUrl: "https://followup.example/",
      });
      await db.insert(scans).values({
        id: scan,
        organizationId: org,
        siteId: site,
        trigger: "manual",
        status: "completed",
        completedAt: new Date(),
      });
      await db.insert(findings).values({
        organizationId: org,
        scanId: scan,
        category: "security",
        severity: "high",
        code: "security-header.csp.missing",
        title: "CSP",
        fingerprint,
      });
      const input = {
        userId: owner,
        organizationId: org,
        siteId: site,
        scanId: scan,
        fingerprint,
        status: "in_progress" as const,
        assigneeUserId: member,
        dueAt: new Date("2026-10-20"),
        note: "Correction prévue",
      };
      await expect(
        updateFindingFollowup({ ...input, assigneeUserId: foreign }),
      ).rejects.toThrow(/hors/);
      await expect(
        updateFindingFollowup({ ...input, userId: member }),
      ).rejects.toThrow();
      await expect(
        updateFindingFollowup({ ...input, status: "accepted", note: null }),
      ).rejects.toThrow(/justification/);
      const record = await updateFindingFollowup(input);
      expect(record.status).toBe("in_progress");
      expect(record.assigneeUserId).toBe(member);
      expect(record.dueAt?.toISOString().slice(0, 10)).toBe("2026-10-20");
      await updateFindingFollowup({
        ...input,
        status: "accepted",
        note: "Exception approuvée et documentée",
      });
      const view = await getFindingFollowups(
        member,
        org,
        site,
        "verified_monitoring",
        [fingerprint],
      );
      expect(view.rows[0]?.status).toBe("accepted");
      expect(view.events.map((event) => event.toStatus)).toContain(
        "in_progress",
      );
      expect(view.events.map((event) => event.toStatus)).toContain("accepted");
      expect(
        (
          await db
            .select()
            .from(findingRemediationEvents)
            .where(eq(findingRemediationEvents.remediationId, record.id))
        ).length,
      ).toBe(2);
      await expect(
        getFindingFollowups(foreign, org, site, "verified_monitoring", [
          fingerprint,
        ]),
      ).rejects.toThrow();
    } finally {
      await db.delete(organizations).where(eq(organizations.id, org));
      await db.delete(organizations).where(eq(organizations.id, foreignOrg));
      await db.delete(users).where(eq(users.id, owner));
      await db.delete(users).where(eq(users.id, member));
      await db.delete(users).where(eq(users.id, foreign));
    }
  });
});
