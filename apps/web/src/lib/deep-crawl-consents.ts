import {
  deepAuditAuthorizations,
  deepCrawlConsents,
  memberships,
  sites,
} from "@agency-saas/db";
import {
  hasCurrentSiteOwnershipProof,
  validDeepCrawlConsentPrefix,
} from "@agency-saas/security";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  OrganizationAccessError,
} from "./organization-site-service";

export class DeepCrawlConsentError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid-paths"
      | "invalid-page-count"
      | "site-not-verified"
      | "deep-grant-required"
      | "grant-too-close-to-expiry",
  ) {
    super(message);
    this.name = "DeepCrawlConsentError";
  }
}
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ConsentContext = {
  userId: string;
  organizationId: string;
  siteId: string;
};

function validInput(maxPages: number, prefixes: readonly string[]): void {
  if (!Number.isSafeInteger(maxPages) || maxPages < 2 || maxPages > 5)
    throw new DeepCrawlConsentError(
      "Page limit must be between 2 and 5",
      "invalid-page-count",
    );
  if (
    !Array.isArray(prefixes) ||
    prefixes.length < 1 ||
    prefixes.length > 10 ||
    new Set(prefixes).size !== prefixes.length ||
    !prefixes.every(validDeepCrawlConsentPrefix)
  )
    throw new DeepCrawlConsentError(
      "Explicit safe path list required",
      "invalid-paths",
    );
}

async function authorized(tx: Transaction, input: ConsentContext) {
  const [site] = await tx
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
  if (!site)
    throw new DeepCrawlConsentError("Site unavailable", "site-not-verified");
  const [membership] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, input.userId),
        eq(memberships.organizationId, input.organizationId),
      ),
    )
    .for("share")
    .limit(1);
  if (!membership || !canManageOrganization(membership.role))
    throw new OrganizationAccessError(
      "Only owners and admins can authorize crawl",
    );
  const [clock] = await tx
    .select({ now: sql<Date>`clock_timestamp()`.mapWith(sites.createdAt) })
    .from(sites)
    .where(eq(sites.id, input.siteId))
    .limit(1);
  const now = clock?.now;
  if (!(now instanceof Date)) throw new Error("Database clock invalid");
  return { site, now };
}

/** No network I/O, no scan activation. Requires two recently verified DNS grants. */
export async function grantDeepCrawlConsent(
  input: ConsentContext & {
    maxPages: number;
    allowedPathPrefixes: readonly string[];
  },
) {
  validInput(input.maxPages, input.allowedPathPrefixes);
  return db.transaction(async (tx) => {
    const { site, now } = await authorized(tx, input);
    const age = (value: Date | null) =>
      !value || value > now || now.getTime() - value.getTime() > 300_000;
    if (
      !hasCurrentSiteOwnershipProof(site, now) ||
      age(site.ownershipRevalidatedAt) ||
      !site.ownershipGeneration ||
      !site.ownershipExpiresAt
    )
      throw new DeepCrawlConsentError(
        "Revalidate site DNS ownership",
        "site-not-verified",
      );
    const [grant] = await tx
      .select()
      .from(deepAuditAuthorizations)
      .where(eq(deepAuditAuthorizations.siteId, input.siteId))
      .for("share")
      .limit(1);
    if (
      !grant ||
      grant.proofType !== "dns_txt" ||
      !grant.proofRecordName ||
      !/^[a-f0-9]{64}$/.test(grant.proofTokenHash ?? "") ||
      grant.revokedAt ||
      grant.proofVerifiedAt > now ||
      (grant.revalidatedAt !== null &&
        grant.revalidatedAt < grant.proofVerifiedAt) ||
      age(grant.revalidatedAt) ||
      grant.expiresAt <= now
    )
      throw new DeepCrawlConsentError(
        "Revalidate Deep DNS grant",
        "deep-grant-required",
      );
    const expiresAt = new Date(
      Math.min(
        now.getTime() + 86_400_000,
        site.ownershipExpiresAt.getTime(),
        grant.expiresAt.getTime(),
      ),
    );
    if (expiresAt.getTime() - now.getTime() < 60_000)
      throw new DeepCrawlConsentError(
        "Renew proofs before granting crawl",
        "grant-too-close-to-expiry",
      );
    const values = {
      siteId: input.siteId,
      organizationId: input.organizationId,
      canonicalUrl: site.canonicalUrl,
      ownershipGeneration: site.ownershipGeneration,
      deepGenerationId: grant.generationId,
      allowedPathPrefixes: [...input.allowedPathPrefixes],
      maxPages: input.maxPages,
      grantedBy: input.userId,
      grantedAt: now,
      expiresAt,
      revokedAt: null,
      updatedAt: now,
    };
    const [row] = await tx
      .insert(deepCrawlConsents)
      .values(values)
      .onConflictDoUpdate({
        target: deepCrawlConsents.siteId,
        set: {
          ...values,
          revision: sql.raw('"deep_crawl_consents"."revision" + 1'),
        },
      })
      .returning();
    if (!row) throw new Error("Consent write unavailable");
    return row;
  });
}

/** Revocation also works for a paused site; a revision change fences future use. */
export async function revokeDeepCrawlConsent(input: ConsentContext) {
  return db.transaction(async (tx) => {
    const { now } = await authorized(tx, input);
    const [row] = await tx
      .update(deepCrawlConsents)
      .set({
        revokedAt: now,
        updatedAt: now,
        revision: sql.raw('"deep_crawl_consents"."revision" + 1'),
      })
      .where(
        and(
          eq(deepCrawlConsents.siteId, input.siteId),
          eq(deepCrawlConsents.organizationId, input.organizationId),
          isNull(deepCrawlConsents.revokedAt),
        ),
      )
      .returning();
    return { revoked: Boolean(row) };
  });
}

export async function getDeepCrawlConsent(input: ConsentContext) {
  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, input.userId),
        eq(memberships.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!membership)
    throw new OrganizationAccessError("Organization membership required");
  const [row] = await db
    .select()
    .from(deepCrawlConsents)
    .where(
      and(
        eq(deepCrawlConsents.siteId, input.siteId),
        eq(deepCrawlConsents.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}
