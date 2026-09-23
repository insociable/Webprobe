import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  findings,
  memberships,
  organizations,
  reportDeliveries,
  reportShares,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { db } from "../database";
import { OrganizationAccessError } from "../organization-site-service";
import { getPublicReportByToken } from "../public-report-service";
import {
  createReportShare,
  queueReportEmail,
  ReportShareEligibilityError,
  ReportShareRateLimitError,
  revokeReportShare,
} from "../report-share-service";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

async function fixture() {
  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  const organizationId = randomUUID();
  const outsiderOrganizationId = randomUUID();
  const siteId = randomUUID();
  const scanId = randomUUID();

  await db.insert(users).values([
    {
      id: ownerId,
      email: "report-owner-" + ownerId + "@example.invalid",
      displayName: "Report owner",
    },
    {
      id: outsiderId,
      email: "report-outsider-" + outsiderId + "@example.invalid",
      displayName: "Report outsider",
    },
  ]);
  await db.insert(organizations).values([
    {
      id: organizationId,
      name: "Internal agency name",
      reportBrandName: "Client Success Studio",
      reportAccentColor: "#123abc",
    },
    { id: outsiderOrganizationId, name: "Other tenant" },
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
    name: "Client site",
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
    pageCount: 1,
    completedAt: new Date("2026-09-22T12:00:00.000Z"),
  });
  await db.insert(findings).values({
    organizationId,
    scanId,
    category: "security-header",
    severity: "medium",
    code: "security-header.csp.missing",
    title: "Content-Security-Policy absent",
    pageUrl: "https://example.com/",
    fingerprint: "c".repeat(64),
    evidence: {},
  });

  return {
    ownerId,
    outsiderId,
    organizationId,
    outsiderOrganizationId,
    siteId,
    scanId,
  };
}
async function cleanup(input: Awaited<ReturnType<typeof fixture>>) {
  await db
    .delete(organizations)
    .where(eq(organizations.id, input.organizationId));
  await db
    .delete(organizations)
    .where(eq(organizations.id, input.outsiderOrganizationId));
  await db.delete(users).where(eq(users.id, input.ownerId));
  await db.delete(users).where(eq(users.id, input.outsiderId));
}

describeDatabase("shareable scan reports", () => {
  it("enforces the recipient quota atomically for concurrent email requests", async () => {
    const f = await fixture();
    const previousSecret = process.env.REPORT_TOKEN_SECRET;
    process.env.REPORT_TOKEN_SECRET =
      "report-test-secret-that-is-at-least-thirty-two-characters";
    try {
      const attempts = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          queueReportEmail(
            f.ownerId,
            f.organizationId,
            f.siteId,
            f.scanId,
            "client@example.com",
          ),
        ),
      );
      expect(
        attempts.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(3);
      expect(
        attempts.filter((item) => item.status === "rejected"),
      ).toHaveLength(1);
    } finally {
      if (previousSecret === undefined) delete process.env.REPORT_TOKEN_SECRET;
      else process.env.REPORT_TOKEN_SECRET = previousSecret;
      await cleanup(f);
    }
  });
  it("resolves a valid token, then rejects expiry and revocation", async () => {
    const f = await fixture();
    const previousSecret = process.env.REPORT_TOKEN_SECRET;
    const previousBaseUrl = process.env.REPORT_PUBLIC_BASE_URL;
    process.env.REPORT_TOKEN_SECRET =
      "report-test-secret-that-is-at-least-thirty-two-characters";
    process.env.REPORT_PUBLIC_BASE_URL = "https://reports.example.test";
    const now = new Date("2026-09-22T12:30:00.000Z");

    try {
      const share = await createReportShare(
        f.ownerId,
        f.organizationId,
        f.siteId,
        f.scanId,
        now,
      );
      expect(share.url).toMatch(
        /^https:\/\/reports\.example\.test\/r\/[A-Za-z0-9_-]{43}$/,
      );

      const token = share.url.split("/").at(-1)!;
      const publicReport = await getPublicReportByToken(
        token,
        new Date("2026-09-23T12:00:00.000Z"),
      );
      expect(publicReport).toMatchObject({
        branding: {
          name: "Client Success Studio",
          accentColor: "#123abc",
        },
        site: { name: "Client site" },
        scan: { pageCount: 1, scanMode: "verified_monitoring" },
      });
      expect(publicReport?.scan.findings).toHaveLength(1);
      await expect(
        getPublicReportByToken(token, new Date("2026-10-01T12:31:00.000Z")),
      ).resolves.toBeNull();

      await expect(
        revokeReportShare(
          f.ownerId,
          f.organizationId,
          f.siteId,
          f.scanId,
          share.id,
          new Date("2026-09-23T12:05:00.000Z"),
        ),
      ).resolves.toBe(true);

      await expect(
        getPublicReportByToken(token, new Date("2026-09-23T12:06:00.000Z")),
      ).resolves.toBeNull();
    } finally {
      if (previousSecret === undefined) delete process.env.REPORT_TOKEN_SECRET;
      else process.env.REPORT_TOKEN_SECRET = previousSecret;
      if (previousBaseUrl === undefined)
        delete process.env.REPORT_PUBLIC_BASE_URL;
      else process.env.REPORT_PUBLIC_BASE_URL = previousBaseUrl;
      await cleanup(f);
    }
  });

  it("prevents cross-tenant management and creates a normalized email outbox row", async () => {
    const f = await fixture();
    const previousSecret = process.env.REPORT_TOKEN_SECRET;
    process.env.REPORT_TOKEN_SECRET =
      "report-test-secret-that-is-at-least-thirty-two-characters";

    try {
      await expect(
        createReportShare(f.outsiderId, f.organizationId, f.siteId, f.scanId),
      ).rejects.toBeInstanceOf(OrganizationAccessError);

      const queued = await queueReportEmail(
        f.ownerId,
        f.organizationId,
        f.siteId,
        f.scanId,
        "  Client@Example.COM ",
      );
      expect(queued.recipientEmail).toBe("client@example.com");

      const [delivery] = await db
        .select({
          organizationId: reportDeliveries.organizationId,
          recipientEmail: reportDeliveries.recipientEmail,
          status: reportDeliveries.status,
          shareId: reportDeliveries.reportShareId,
        })
        .from(reportDeliveries)
        .where(
          and(
            eq(reportDeliveries.organizationId, f.organizationId),
            eq(reportDeliveries.scanId, f.scanId),
          ),
        );

      expect(delivery).toMatchObject({
        organizationId: f.organizationId,
        recipientEmail: "client@example.com",
        status: "pending",
        shareId: queued.shareId,
      });

      const [shareRow] = await db
        .select({
          tokenHash: reportShares.tokenHash,
          tokenCiphertext: reportShares.tokenCiphertext,
        })
        .from(reportShares)
        .where(eq(reportShares.id, queued.shareId));

      const rawToken = queued.url.split("/").at(-1)!;
      expect(shareRow?.tokenHash).not.toBe(rawToken);
      expect(shareRow?.tokenCiphertext).not.toContain(rawToken);
    } finally {
      if (previousSecret === undefined) delete process.env.REPORT_TOKEN_SECRET;
      else process.env.REPORT_TOKEN_SECRET = previousSecret;
      await cleanup(f);
    }
  });

  it("keeps an unverified public audit private", async () => {
    const f = await fixture();
    const previousSecret = process.env.REPORT_TOKEN_SECRET;
    process.env.REPORT_TOKEN_SECRET =
      "report-test-secret-that-is-at-least-thirty-two-characters";

    try {
      await db
        .update(sites)
        .set({ status: "pending_verification", verifiedAt: null })
        .where(eq(sites.id, f.siteId));
      await db
        .update(scans)
        .set({ scanMode: "public_audit" })
        .where(eq(scans.id, f.scanId));

      await expect(
        createReportShare(f.ownerId, f.organizationId, f.siteId, f.scanId),
      ).rejects.toBeInstanceOf(ReportShareEligibilityError);
      await expect(
        queueReportEmail(
          f.ownerId,
          f.organizationId,
          f.siteId,
          f.scanId,
          "client@example.com",
        ),
      ).rejects.toBeInstanceOf(ReportShareEligibilityError);

      const shares = await db
        .select({ id: reportShares.id })
        .from(reportShares)
        .where(eq(reportShares.scanId, f.scanId));
      const deliveries = await db
        .select({ id: reportDeliveries.id })
        .from(reportDeliveries)
        .where(eq(reportDeliveries.scanId, f.scanId));

      expect(shares).toHaveLength(0);
      expect(deliveries).toHaveLength(0);
    } finally {
      if (previousSecret === undefined) delete process.env.REPORT_TOKEN_SECRET;
      else process.env.REPORT_TOKEN_SECRET = previousSecret;
      await cleanup(f);
    }
  });

  it("compares shared reports only with a previous scan of the same mode", async () => {
    const f = await fixture();
    const previousSecret = process.env.REPORT_TOKEN_SECRET;
    const previousBaseUrl = process.env.REPORT_PUBLIC_BASE_URL;
    process.env.REPORT_TOKEN_SECRET =
      "report-test-secret-that-is-at-least-thirty-two-characters";
    process.env.REPORT_PUBLIC_BASE_URL = "https://reports.example.test";

    try {
      await db
        .update(sites)
        .set({ status: "pending_verification", verifiedAt: null })
        .where(eq(sites.id, f.siteId));
      await db
        .update(scans)
        .set({
          scanMode: "public_audit",
          completedAt: new Date("2026-09-22T10:00:00.000Z"),
        })
        .where(eq(scans.id, f.scanId));

      // DNS verification changes site eligibility, not the historical mode.
      await db
        .update(sites)
        .set({
          status: "active",
          verifiedAt: new Date("2026-09-22T10:30:00.000Z"),
        })
        .where(eq(sites.id, f.siteId));

      const verifiedFirstId = randomUUID();
      const publicSecondId = randomUUID();
      const verifiedSecondId = randomUUID();
      await db.insert(scans).values([
        {
          id: verifiedFirstId,
          organizationId: f.organizationId,
          siteId: f.siteId,
          trigger: "manual",
          scanMode: "verified_monitoring",
          status: "completed",
          pageCount: 1,
          completedAt: new Date("2026-09-22T11:00:00.000Z"),
        },
        {
          id: publicSecondId,
          organizationId: f.organizationId,
          siteId: f.siteId,
          trigger: "manual",
          scanMode: "public_audit",
          status: "completed",
          pageCount: 1,
          completedAt: new Date("2026-09-22T12:00:00.000Z"),
        },
        {
          id: verifiedSecondId,
          organizationId: f.organizationId,
          siteId: f.siteId,
          trigger: "manual",
          scanMode: "verified_monitoring",
          status: "completed",
          pageCount: 1,
          completedAt: new Date("2026-09-22T13:00:00.000Z"),
        },
      ]);
      await db.insert(findings).values([
        {
          organizationId: f.organizationId,
          scanId: verifiedFirstId,
          category: "security-header",
          severity: "low",
          code: "security-header.hsts.missing",
          title: "Strict-Transport-Security absent",
          pageUrl: "https://example.com/",
          fingerprint: "d".repeat(64),
          evidence: {},
        },
        {
          organizationId: f.organizationId,
          scanId: publicSecondId,
          category: "security-header",
          severity: "medium",
          code: "security-header.csp.missing",
          title: "Content-Security-Policy absent",
          pageUrl: "https://example.com/",
          fingerprint: "c".repeat(64),
          evidence: {},
        },
        {
          organizationId: f.organizationId,
          scanId: verifiedSecondId,
          category: "security-header",
          severity: "low",
          code: "security-header.hsts.missing",
          title: "Strict-Transport-Security absent",
          pageUrl: "https://example.com/",
          fingerprint: "d".repeat(64),
          evidence: {},
        },
      ]);

      const reportAt = async (scanId: string) => {
        const share = await createReportShare(
          f.ownerId,
          f.organizationId,
          f.siteId,
          scanId,
          new Date("2026-09-22T14:00:00.000Z"),
        );
        return getPublicReportByToken(
          share.url.split("/").at(-1)!,
          new Date("2026-09-22T14:01:00.000Z"),
        );
      };

      expect((await reportAt(verifiedFirstId))?.comparison).toBeNull();
      const publicSecondReport = await reportAt(publicSecondId);
      expect(publicSecondReport?.scan.scanMode).toBe("public_audit");
      expect(publicSecondReport?.comparison?.counts).toMatchObject({
        unchanged: 1,
        new: 0,
        resolved: 0,
      });
      expect(
        (await reportAt(verifiedSecondId))?.comparison?.counts,
      ).toMatchObject({
        unchanged: 1,
        new: 0,
        resolved: 0,
      });
    } finally {
      if (previousSecret === undefined) delete process.env.REPORT_TOKEN_SECRET;
      else process.env.REPORT_TOKEN_SECRET = previousSecret;
      if (previousBaseUrl === undefined)
        delete process.env.REPORT_PUBLIC_BASE_URL;
      else process.env.REPORT_PUBLIC_BASE_URL = previousBaseUrl;
      await cleanup(f);
    }
  });

  it("enforces the hourly recipient email quota without creating an extra delivery", async () => {
    const f = await fixture();
    const previousSecret = process.env.REPORT_TOKEN_SECRET;
    process.env.REPORT_TOKEN_SECRET =
      "report-test-secret-that-is-at-least-thirty-two-characters";
    const now = new Date("2026-09-22T13:00:00.000Z");
    const recipientEmail = "client@example.com";

    try {
      const shareIds = Array.from({ length: 5 }, () => randomUUID());
      await db.insert(reportShares).values(
        shareIds.map((id, index) => ({
          id,
          organizationId: f.organizationId,
          siteId: f.siteId,
          scanId: f.scanId,
          tokenHash: (index + 1).toString(16).padStart(64, "0"),
          tokenCiphertext: `cipher-${index + 1}`,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          createdByUserId: f.ownerId,
          createdAt: new Date(now.getTime() - 10 * 60_000),
        })),
      );
      await db.insert(reportDeliveries).values(
        shareIds.map((reportShareId, index) => ({
          reportShareId,
          organizationId: f.organizationId,
          siteId: f.siteId,
          scanId: f.scanId,
          recipientEmail,
          createdAt: new Date(now.getTime() - index * 60_000),
          updatedAt: new Date(now.getTime() - index * 60_000),
        })),
      );

      await expect(
        queueReportEmail(
          f.ownerId,
          f.organizationId,
          f.siteId,
          f.scanId,
          recipientEmail,
          now,
        ),
      ).rejects.toBeInstanceOf(ReportShareRateLimitError);

      const deliveries = await db
        .select({ id: reportDeliveries.id })
        .from(reportDeliveries)
        .where(
          and(
            eq(reportDeliveries.organizationId, f.organizationId),
            eq(reportDeliveries.recipientEmail, recipientEmail),
          ),
        );
      expect(deliveries).toHaveLength(5);
    } finally {
      if (previousSecret === undefined) delete process.env.REPORT_TOKEN_SECRET;
      else process.env.REPORT_TOKEN_SECRET = previousSecret;
      await cleanup(f);
    }
  });
});
