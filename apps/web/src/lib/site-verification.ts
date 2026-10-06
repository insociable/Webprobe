import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Resolver } from "node:dns/promises";
import { siteVerificationChallenges, sites } from "@agency-saas/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  canonicalSiteOrigin,
  classifyOwnershipDnsFailure,
  getSiteOwnershipProofTtlMs,
  hasCurrentSiteOwnershipProof,
  matchesSiteOwnershipToken,
  siteOwnershipRecordName,
} from "@agency-saas/security";
import { db } from "./database";
import {
  canManageOrganization,
  getSiteForOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";

const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
const DNS_TIMEOUT_MS = 5_000;

export type TxtResolver = (hostname: string) => Promise<string[][]>;
type OwnershipProofRow = typeof sites.$inferSelect;

export class SiteVerificationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "site-not-found"
      | "site-not-active"
      | "already-verified"
      | "challenge-not-found"
      | "challenge-expired"
      | "dns-record-not-found"
      | "dns-unavailable"
      | "ownership-reverification-required",
  ) {
    super(message);
    this.name = "SiteVerificationError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenMatches(candidate: string, expectedHash: string): boolean {
  const candidateHash = Buffer.from(hashToken(candidate), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    candidateHash.length === expected.length &&
    timingSafeEqual(candidateHash, expected)
  );
}

async function resolveTxtBounded(
  name: string,
  resolver?: TxtResolver,
): Promise<string[][]> {
  const dnsResolver = resolver ? undefined : new Resolver();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      (resolver ?? ((recordName) => dnsResolver!.resolveTxt(recordName)))(name),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          dnsResolver?.cancel();
          reject(
            Object.assign(new Error("DNS TXT lookup timed out"), {
              code: "ETIMEOUT",
            }),
          );
        }, DNS_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function hasCompleteOwnershipProof(site: OwnershipProofRow): boolean {
  return Boolean(
    site.ownershipTokenHash &&
      /^[a-f0-9]{64}$/.test(site.ownershipTokenHash) &&
      site.ownershipRecordName &&
      site.ownershipOrigin &&
      site.ownershipGeneration &&
      site.ownershipVerifiedAt &&
      site.ownershipExpiresAt &&
      site.ownershipRevalidatedAt,
  );
}

async function markOwnershipProofInvalidated(site: OwnershipProofRow) {
  if (
    !site.ownershipTokenHash ||
    !site.ownershipGeneration ||
    !site.ownershipOrigin
  ) {
    return;
  }
  await db
    .update(sites)
    .set({
      ownershipInvalidatedAt: sql<Date>`clock_timestamp()`.mapWith(
        sites.updatedAt,
      ),
    })
    .where(
      and(
        eq(sites.id, site.id),
        eq(sites.organizationId, site.organizationId),
        eq(sites.canonicalUrl, site.canonicalUrl),
        eq(sites.ownershipTokenHash, site.ownershipTokenHash),
        eq(sites.ownershipGeneration, site.ownershipGeneration),
        eq(sites.ownershipOrigin, site.ownershipOrigin),
        isNull(sites.ownershipInvalidatedAt),
      ),
    );
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
  if (hasCurrentSiteOwnershipProof(site)) {
    throw new SiteVerificationError(
      "Site ownership proof is current",
      "already-verified",
    );
  }

  let recordName: string;
  try {
    recordName = siteOwnershipRecordName(site.canonicalUrl);
  } catch {
    throw new SiteVerificationError(
      "The site does not have a domain suitable for DNS verification",
      "site-not-found",
    );
  }

  const token = `agency-monitor-verification=${randomBytes(24).toString("base64url")}`;
  const tokenHash = hashToken(token);
  const generationId = randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  const now = new Date();

  const [challenge] = await db
    .insert(siteVerificationChallenges)
    .values({
      id: generationId,
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
        id: generationId,
        organizationId,
        tokenHash,
        recordName,
        expiresAt,
        updatedAt: now,
      },
    })
    .returning({ id: siteVerificationChallenges.id });

  if (!challenge) throw new Error("Verification challenge could not be stored");
  return { recordName, token, expiresAt };
}

export async function revalidateSiteOwnershipProof(input: {
  organizationId: string;
  siteId: string;
  force?: boolean;
  resolver?: TxtResolver;
}): Promise<OwnershipProofRow> {
  const [site] = await db
    .select()
    .from(sites)
    .where(
      and(
        eq(sites.id, input.siteId),
        eq(sites.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!site) {
    throw new SiteVerificationError("Site not found", "site-not-found");
  }
  if (site.status !== "active" || !site.verifiedAt) {
    throw new SiteVerificationError(
      "Site must be active and verified",
      "site-not-active",
    );
  }
  if (!hasCompleteOwnershipProof(site) || site.ownershipInvalidatedAt) {
    throw new SiteVerificationError(
      "Site ownership must be verified again",
      "ownership-reverification-required",
    );
  }

  let expectedOrigin: string;
  let expectedRecordName: string;
  try {
    expectedOrigin = canonicalSiteOrigin(site.canonicalUrl);
    expectedRecordName = siteOwnershipRecordName(site.canonicalUrl);
  } catch {
    await markOwnershipProofInvalidated(site);
    throw new SiteVerificationError(
      "Site ownership must be verified again",
      "ownership-reverification-required",
    );
  }
  if (
    site.ownershipOrigin !== expectedOrigin ||
    site.ownershipRecordName !== expectedRecordName
  ) {
    await markOwnershipProofInvalidated(site);
    throw new SiteVerificationError(
      "Site ownership must be verified again",
      "ownership-reverification-required",
    );
  }

  if (!input.force && hasCurrentSiteOwnershipProof(site)) {
    return site;
  }

  let records: string[][];
  try {
    records = await resolveTxtBounded(expectedRecordName, input.resolver);
  } catch (error) {
    if (classifyOwnershipDnsFailure(error) === "missing") {
      await markOwnershipProofInvalidated(site);
      throw new SiteVerificationError(
        "The ownership TXT record is missing",
        "dns-record-not-found",
      );
    }
    throw new SiteVerificationError(
      "DNS is temporarily unavailable",
      "dns-unavailable",
    );
  }

  if (!matchesSiteOwnershipToken(records, site.ownershipTokenHash!)) {
    await markOwnershipProofInvalidated(site);
    throw new SiteVerificationError(
      "The ownership TXT record does not match",
      "dns-record-not-found",
    );
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(sites)
      .where(
        and(
          eq(sites.id, input.siteId),
          eq(sites.organizationId, input.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !current ||
      current.status !== "active" ||
      !current.verifiedAt ||
      current.ownershipInvalidatedAt ||
      current.canonicalUrl !== site.canonicalUrl ||
      current.ownershipOrigin !== site.ownershipOrigin ||
      current.ownershipRecordName !== site.ownershipRecordName ||
      current.ownershipTokenHash !== site.ownershipTokenHash ||
      current.ownershipGeneration !== site.ownershipGeneration ||
      current.ownershipVerifiedAt?.getTime() !==
        site.ownershipVerifiedAt?.getTime()
    ) {
      throw new SiteVerificationError(
        "Site ownership proof changed during verification",
        "ownership-reverification-required",
      );
    }

    const [clock] = await tx
      .select({ now: sql<Date>`clock_timestamp()`.mapWith(sites.createdAt) })
      .from(sites)
      .where(eq(sites.id, input.siteId))
      .limit(1);
    if (!clock) throw new Error("Could not read database clock");

    const [updated] = await tx
      .update(sites)
      .set({
        ownershipExpiresAt: new Date(
          clock.now.getTime() + getSiteOwnershipProofTtlMs(),
        ),
        ownershipRevalidatedAt: clock.now,
        updatedAt: clock.now,
      })
      .where(
        and(
          eq(sites.id, input.siteId),
          eq(sites.organizationId, input.organizationId),
          eq(sites.ownershipGeneration, site.ownershipGeneration!),
          eq(sites.ownershipTokenHash, site.ownershipTokenHash!),
          isNull(sites.ownershipInvalidatedAt),
        ),
      )
      .returning();
    if (!updated) {
      throw new SiteVerificationError(
        "Site ownership proof changed during verification",
        "ownership-reverification-required",
      );
    }
    return updated;
  });
}

export async function verifySiteDnsChallenge(
  userId: string,
  organizationId: string,
  siteId: string,
  resolver?: TxtResolver,
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
    if (
      hasCompleteOwnershipProof(site) &&
      !site.ownershipInvalidatedAt &&
      site.ownershipExpiresAt!.getTime() <= Date.now()
    ) {
      return revalidateSiteOwnershipProof({
        organizationId,
        siteId,
        force: true,
        resolver,
      });
    }
    if (hasCurrentSiteOwnershipProof(site)) return site;
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
    records = await resolveTxtBounded(challenge.recordName, resolver);
  } catch (error) {
    if (classifyOwnershipDnsFailure(error) === "missing") {
      throw new SiteVerificationError(
        "Verification DNS record not found",
        "dns-record-not-found",
      );
    }
    throw new SiteVerificationError(
      "DNS is temporarily unavailable",
      "dns-unavailable",
    );
  }

  const matched = records.some((chunks) =>
    tokenMatches(chunks.join(""), challenge.tokenHash),
  );
  if (!matched) {
    throw new SiteVerificationError(
      "Verification DNS record does not match",
      "dns-record-not-found",
    );
  }

  return db.transaction(async (tx) => {
    const [currentSite] = await tx
      .select()
      .from(sites)
      .where(
        and(eq(sites.id, siteId), eq(sites.organizationId, organizationId)),
      )
      .for("update")
      .limit(1);
    const [currentChallenge] = await tx
      .select()
      .from(siteVerificationChallenges)
      .where(
        and(
          eq(siteVerificationChallenges.organizationId, organizationId),
          eq(siteVerificationChallenges.siteId, siteId),
        ),
      )
      .for("update")
      .limit(1);
    const [clock] = await tx
      .select({ now: sql<Date>`clock_timestamp()`.mapWith(sites.createdAt) })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);
    if (
      !currentSite ||
      !currentChallenge ||
      !clock ||
      currentSite.canonicalUrl !== site.canonicalUrl ||
      currentChallenge.id !== challenge.id ||
      currentChallenge.tokenHash !== challenge.tokenHash ||
      currentChallenge.expiresAt <= clock.now
    ) {
      throw new SiteVerificationError(
        "Verification challenge expired or changed",
        "challenge-expired",
      );
    }

    const now = clock.now;
    const [verifiedSite] = await tx
      .update(sites)
      .set({
        status:
          currentSite.status === "pending_verification"
            ? "active"
            : currentSite.status,
        verifiedAt: currentSite.verifiedAt ?? now,
        ownershipTokenHash: challenge.tokenHash,
        ownershipRecordName: challenge.recordName,
        ownershipOrigin: canonicalSiteOrigin(currentSite.canonicalUrl),
        ownershipGeneration: challenge.id,
        ownershipVerifiedAt: now,
        ownershipExpiresAt: new Date(
          now.getTime() + getSiteOwnershipProofTtlMs(),
        ),
        ownershipRevalidatedAt: now,
        ownershipInvalidatedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(sites.id, siteId),
          eq(sites.organizationId, organizationId),
          eq(sites.canonicalUrl, currentSite.canonicalUrl),
        ),
      )
      .returning();
    if (!verifiedSite) {
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
          eq(siteVerificationChallenges.id, challenge.id),
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

  const ownershipState: "missing" | "invalidated" | "expired" | "current" =
    !hasCompleteOwnershipProof(site)
      ? "missing"
      : site.ownershipInvalidatedAt
        ? "invalidated"
        : hasCurrentSiteOwnershipProof(site)
          ? "current"
          : "expired";

  return {
    site,
    ownershipState,
    challenge: challenge[0] ?? null,
    recordName: siteOwnershipRecordName(site.canonicalUrl),
  };
}
