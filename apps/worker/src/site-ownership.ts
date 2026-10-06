import { Resolver } from "node:dns/promises";
import { sites } from "@agency-saas/db";
import {
  canonicalSiteOrigin,
  classifyOwnershipDnsFailure,
  getSiteOwnershipProofTtlMs,
  hasCurrentSiteOwnershipProof,
  matchesSiteOwnershipToken,
  siteOwnershipRecordName,
} from "@agency-saas/security";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDatabase } from "./database.js";

export type OwnershipResolver = (name: string) => Promise<string[][]>;
type Site = typeof sites.$inferSelect;

export class SiteOwnershipError extends Error {
  constructor(
    readonly code:
      | "ownership-reverification-required"
      | "dns-record-not-found"
      | "dns-unavailable"
      | "site-not-active",
  ) {
    super(code);
    this.name = "SiteOwnershipError";
  }
}

function sameProof(a: Site, b: Site): boolean {
  return (
    a.id === b.id &&
    a.organizationId === b.organizationId &&
    a.canonicalUrl === b.canonicalUrl &&
    a.verifiedAt?.getTime() === b.verifiedAt?.getTime() &&
    a.ownershipOrigin === b.ownershipOrigin &&
    a.ownershipRecordName === b.ownershipRecordName &&
    a.ownershipGeneration === b.ownershipGeneration &&
    a.ownershipTokenHash === b.ownershipTokenHash &&
    a.ownershipVerifiedAt?.getTime() === b.ownershipVerifiedAt?.getTime()
  );
}

async function resolveTxtBounded(
  name: string,
  resolver: OwnershipResolver | undefined,
  signal: AbortSignal | undefined,
): Promise<string[][]> {
  if (signal?.aborted) throw new Error("Ownership lookup aborted");
  const dns = resolver ? undefined : new Resolver();
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      (resolver ?? ((hostname) => dns!.resolveTxt(hostname)))(name),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          dns?.cancel();
          reject(Object.assign(new Error("DNS timeout"), { code: "ETIMEOUT" }));
        }, 5_000);
        timer.unref();
      }),
      new Promise<never>((_, reject) => {
        onAbort = () => {
          dns?.cancel();
          reject(new Error("Ownership lookup aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

async function invalidate(site: Site): Promise<void> {
  const { db } = getDatabase();
  await db
    .update(sites)
    .set({ ownershipInvalidatedAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(sites.id, site.id),
        eq(sites.organizationId, site.organizationId),
        eq(sites.canonicalUrl, site.canonicalUrl),
        eq(sites.ownershipGeneration, site.ownershipGeneration!),
        eq(sites.ownershipTokenHash, site.ownershipTokenHash!),
        isNull(sites.ownershipInvalidatedAt),
      ),
    );
}

/** Refreshes a durable TXT proof only when stale, or for every Deep run. */
export async function ensureSiteOwnershipProof(input: {
  organizationId: string;
  siteId: string;
  force?: boolean;
  resolver?: OwnershipResolver;
  signal?: AbortSignal;
  onResolvedAnswers?: (answers: string[][]) => void;
}): Promise<Site> {
  const { db } = getDatabase();
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
  if (!site || site.status !== "active" || !site.verifiedAt) {
    throw new SiteOwnershipError("site-not-active");
  }
  if (
    !site.ownershipTokenHash ||
    !/^[a-f0-9]{64}$/.test(site.ownershipTokenHash) ||
    !site.ownershipGeneration ||
    !site.ownershipRecordName ||
    !site.ownershipOrigin ||
    !site.ownershipVerifiedAt ||
    !site.ownershipExpiresAt ||
    !site.ownershipRevalidatedAt ||
    site.ownershipInvalidatedAt
  ) {
    throw new SiteOwnershipError("ownership-reverification-required");
  }
  try {
    if (
      site.ownershipOrigin !== canonicalSiteOrigin(site.canonicalUrl) ||
      site.ownershipRecordName !== siteOwnershipRecordName(site.canonicalUrl)
    ) {
      await invalidate(site);
      throw new SiteOwnershipError("ownership-reverification-required");
    }
  } catch (error) {
    if (error instanceof SiteOwnershipError) throw error;
    await invalidate(site);
    throw new SiteOwnershipError("ownership-reverification-required");
  }
  if (!input.force && hasCurrentSiteOwnershipProof(site)) return site;

  let answers: string[][];
  try {
    answers = await resolveTxtBounded(
      site.ownershipRecordName,
      input.resolver,
      input.signal,
    );
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (classifyOwnershipDnsFailure(error) === "missing") {
      await invalidate(site);
      throw new SiteOwnershipError("dns-record-not-found");
    }
    // SERVFAIL, timeout and resolver errors do not revoke an existing proof.
    throw new SiteOwnershipError("dns-unavailable");
  }
  if (input.signal?.aborted) throw new Error("Ownership lookup aborted");
  if (!matchesSiteOwnershipToken(answers, site.ownershipTokenHash)) {
    await invalidate(site);
    throw new SiteOwnershipError("dns-record-not-found");
  }
  input.onResolvedAnswers?.(answers);

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
      !sameProof(current, site)
    ) {
      throw new SiteOwnershipError("ownership-reverification-required");
    }
    const [clock] = await tx
      .select({ now: sql<Date>`clock_timestamp()`.mapWith(sites.createdAt) })
      .from(sites)
      .where(eq(sites.id, input.siteId))
      .limit(1);
    if (!clock || input.signal?.aborted) {
      throw new SiteOwnershipError("ownership-reverification-required");
    }
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
      throw new SiteOwnershipError("ownership-reverification-required");
    }
    return updated;
  });
}
