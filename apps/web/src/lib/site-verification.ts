import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { siteVerificationChallenges, sites } from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  getSiteForOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";

const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
const DNS_PREFIX = "_agency-monitor";

export type TxtResolver = (hostname: string) => Promise<string[][]>;

export class SiteVerificationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "site-not-found"
      | "already-verified"
      | "challenge-not-found"
      | "challenge-expired"
      | "dns-record-not-found",
  ) {
    super(message);
    this.name = "SiteVerificationError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(candidate: string, expectedHash: string): boolean {
  const candidateHash = Buffer.from(hashToken(candidate), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    candidateHash.length === expected.length &&
    timingSafeEqual(candidateHash, expected)
  );
}

function verificationRecordName(canonicalUrl: string): string {
  const hostname = new URL(canonicalUrl).hostname;
  return `${DNS_PREFIX}.${hostname}`;
}

export async function createSiteVerificationChallenge(
  userId: string,
  organizationId: string,
  siteId: string,
) {
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only organization owners and admins can verify sites",
    );
  }

  const site = await getSiteForOrganization(userId, organizationId, siteId);
  if (!site) {
    throw new SiteVerificationError("Site not found", "site-not-found");
  }
  if (site.status === "active" && site.verifiedAt) {
    throw new SiteVerificationError(
      "Site is already verified",
      "already-verified",
    );
  }

  const token = `agency-monitor-verification=${randomBytes(24).toString("base64url")}`;
  const tokenHash = hashToken(token);
  const recordName = verificationRecordName(site.canonicalUrl);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  const now = new Date();

  await db
    .insert(siteVerificationChallenges)
    .values({
      organizationId,
      siteId,
      tokenHash,
      recordName,
      expiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: siteVerificationChallenges.siteId,
      set: {
        organizationId,
        tokenHash,
        recordName,
        expiresAt,
        updatedAt: now,
      },
    });

  return {
    recordName,
    token,
    expiresAt,
  };
}

function isMissingDnsRecord(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return false;
  }

  return ["ENODATA", "ENOTFOUND", "ESERVFAIL", "ETIMEOUT"].includes(error.code);
}

export async function verifySiteDnsChallenge(
  userId: string,
  organizationId: string,
  siteId: string,
  resolver: TxtResolver = resolveTxt,
) {
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only organization owners and admins can verify sites",
    );
  }

  const site = await getSiteForOrganization(userId, organizationId, siteId);
  if (!site) {
    throw new SiteVerificationError("Site not found", "site-not-found");
  }
  if (site.status === "active" && site.verifiedAt) {
    return site;
  }

  const challengeRows = await db
    .select()
    .from(siteVerificationChallenges)
    .where(
      and(
        eq(siteVerificationChallenges.organizationId, organizationId),
        eq(siteVerificationChallenges.siteId, siteId),
      ),
    )
    .limit(1);

  const challenge = challengeRows[0];
  if (!challenge) {
    throw new SiteVerificationError(
      "Verification challenge not found",
      "challenge-not-found",
    );
  }

  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new SiteVerificationError(
      "Verification challenge expired",
      "challenge-expired",
    );
  }

  let records: string[][];
  try {
    records = await resolver(challenge.recordName);
  } catch (error) {
    if (isMissingDnsRecord(error)) {
      throw new SiteVerificationError(
        "Verification DNS record not found",
        "dns-record-not-found",
      );
    }
    throw error;
  }

  const matched = records.some((chunks) =>
    tokenMatches(chunks.join(""), challenge.tokenHash),
  );

  if (!matched) {
    throw new SiteVerificationError(
      "Verification DNS record not found",
      "dns-record-not-found",
    );
  }

  const verifiedAt = new Date();

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(sites)
      .set({
        status: "active",
        verifiedAt,
        updatedAt: verifiedAt,
      })
      .where(
        and(
          eq(sites.id, siteId),
          eq(sites.organizationId, organizationId),
          eq(sites.status, "pending_verification"),
        ),
      )
      .returning();

    const verifiedSite = updated[0];
    if (!verifiedSite) {
      const current = await tx
        .select()
        .from(sites)
        .where(
          and(eq(sites.id, siteId), eq(sites.organizationId, organizationId)),
        )
        .limit(1);

      if (current[0]?.status === "active") {
        return current[0];
      }

      throw new SiteVerificationError(
        "Site cannot be verified in its current state",
        "site-not-found",
      );
    }

    await tx
      .delete(siteVerificationChallenges)
      .where(
        and(
          eq(siteVerificationChallenges.organizationId, organizationId),
          eq(siteVerificationChallenges.siteId, siteId),
        ),
      );

    return verifiedSite;
  });
}

export async function getSiteVerificationChallengeState(
  userId: string,
  organizationId: string,
  siteId: string,
) {
  await requireOrganizationAccess(userId, organizationId);

  const site = await getSiteForOrganization(userId, organizationId, siteId);
  if (!site) {
    throw new SiteVerificationError("Site not found", "site-not-found");
  }

  const challenge = await db
    .select({
      recordName: siteVerificationChallenges.recordName,
      expiresAt: siteVerificationChallenges.expiresAt,
    })
    .from(siteVerificationChallenges)
    .where(
      and(
        eq(siteVerificationChallenges.organizationId, organizationId),
        eq(siteVerificationChallenges.siteId, siteId),
      ),
    )
    .limit(1);

  return {
    site,
    challenge: challenge[0] ?? null,
    recordName: verificationRecordName(site.canonicalUrl),
  };
}
