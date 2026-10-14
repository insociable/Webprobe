import { deepCrawlConsents } from "@agency-saas/db";
import { validDeepCrawlConsentPrefix } from "@agency-saas/security";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "../database.js";
import {
  assertDeepLease,
  type DeepGrantIdentity,
  type DeepLease,
} from "./deep-lease.js";

/**
 * Server-authoritative, revision-fenced consent. The scan job payload must
 * never be the source of consent or its scope.
 */
type ConsentRecord = typeof deepCrawlConsents.$inferSelect;

type Expected = {
  organizationId: string;
  siteId: string;
  canonicalUrl: string;
  ownershipGeneration: string;
  deepGenerationId: string;
  revision?: number;
};

export type DeepCrawlPermission = Readonly<{
  canonicalUrl: string;
  allowedPathPrefixes: readonly string[];
  maxPages: number;
  revision: number;
  assertCurrent: () => Promise<void>;
}>;

export function assertDeepCrawlConsentRecord(
  row: ConsentRecord | undefined,
  now: Date,
  expected: Expected,
): asserts row is ConsentRecord {
  if (
    !row ||
    row.organizationId !== expected.organizationId ||
    row.siteId !== expected.siteId ||
    row.canonicalUrl !== expected.canonicalUrl ||
    row.ownershipGeneration !== expected.ownershipGeneration ||
    row.deepGenerationId !== expected.deepGenerationId ||
    row.revokedAt !== null ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    (expected.revision !== undefined && row.revision !== expected.revision) ||
    !Number.isSafeInteger(row.maxPages) ||
    row.maxPages < 2 ||
    row.maxPages > 5 ||
    !Array.isArray(row.allowedPathPrefixes) ||
    row.allowedPathPrefixes.length < 1 ||
    row.allowedPathPrefixes.length > 10 ||
    new Set(row.allowedPathPrefixes).size !== row.allowedPathPrefixes.length ||
    !row.allowedPathPrefixes.every(validDeepCrawlConsentPrefix) ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !(row.grantedAt instanceof Date) ||
    !(row.expiresAt instanceof Date) ||
    !Number.isFinite(row.grantedAt.getTime()) ||
    !Number.isFinite(row.expiresAt.getTime()) ||
    row.grantedAt > now ||
    row.expiresAt <= now ||
    row.expiresAt <= row.grantedAt ||
    row.expiresAt.getTime() - row.grantedAt.getTime() > 86_400_000
  ) {
    throw new Error("Deep crawl consent unavailable, stale or revoked");
  }
}

async function readConsent(lease: DeepLease) {
  const { db } = getDatabase();
  const [record] = await db
    .select({
      consent: deepCrawlConsents,
      now: sql<Date>`clock_timestamp()`.mapWith(deepCrawlConsents.grantedAt),
    })
    .from(deepCrawlConsents)
    .where(
      and(
        eq(deepCrawlConsents.siteId, lease.siteId),
        eq(deepCrawlConsents.organizationId, lease.organizationId),
      ),
    )
    .limit(1);
  return record;
}

/**
 * Read and revision-fence consent on the current Deep lease. Each request,
 * navigation and proxy connection must call assertCurrent; a DB outage fails
 * closed. This opt-in gate is disabled in all existing environments.
 */
export async function loadDeepCrawlPermission(input: {
  lease: DeepLease;
  grantIdentity: DeepGrantIdentity;
}): Promise<DeepCrawlPermission> {
  if (process.env.WEBPROBE_DEEP_MULTIPAGE_RUNTIME !== "enabled") {
    throw new Error("Deep multi-page runtime disabled");
  }
  const { lease, grantIdentity } = input;
  if (!grantIdentity.generationId || !grantIdentity.ownershipGeneration) {
    throw new Error("Deep grant identity missing");
  }
  const expected: Expected = {
    siteId: lease.siteId,
    organizationId: lease.organizationId,
    canonicalUrl: grantIdentity.canonicalUrl,
    ownershipGeneration: grantIdentity.ownershipGeneration,
    deepGenerationId: grantIdentity.generationId,
  };
  const current = async (revision?: number) => {
    // The Deep attempt token, lease, site proof and Deep grant are checked
    // against current database state, not stale in-memory snapshots.
    await assertDeepLease(lease, grantIdentity);
    const record = await readConsent(lease);
    assertDeepCrawlConsentRecord(
      record?.consent,
      record?.now ?? new Date(Number.NaN),
      revision === undefined ? expected : { ...expected, revision },
    );
    return record!.consent;
  };

  const initial = await current();
  const revision = initial.revision;
  const allowedPathPrefixes = Object.freeze([...initial.allowedPathPrefixes]);
  const maxPages = initial.maxPages;
  return {
    canonicalUrl: expected.canonicalUrl,
    allowedPathPrefixes,
    maxPages,
    revision,
    async assertCurrent(): Promise<void> {
      const row = await current(revision);
      if (
        row.maxPages !== maxPages ||
        row.allowedPathPrefixes.length !== allowedPathPrefixes.length ||
        row.allowedPathPrefixes.some(
          (value, index) => value !== allowedPathPrefixes[index],
        )
      ) {
        throw new Error("Deep crawl consent scope changed");
      }
    },
  };
}
