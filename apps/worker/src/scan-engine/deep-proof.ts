import { createHash, timingSafeEqual } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { deepAuditAuthorizations, sites } from "@agency-saas/db";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "../database.js";
import { authorizeScan, type AuthorizationDecision } from "./authorization.js";

export type TxtResolver = (name: string) => Promise<string[][]>;

function abortError(): Error {
  return new Error("Deep authorization aborted");
}

export function expectedDeepProofRecord(canonicalUrl: string): string {
  const url = new URL(canonicalUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid canonical URL for DNS proof");
  }
  return `_agency-monitor.${url.hostname.replace(/\.$/, "").toLowerCase()}`;
}

export function matchesDeepProof(
  answers: readonly (readonly string[])[],
  expectedHash: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || answers.length > 32) {
    return false;
  }
  const expected = Buffer.from(expectedHash, "hex");
  for (const fragments of answers) {
    const record = fragments.join("");
    if (record.length > 1024) return false;
    const actual = createHash("sha256").update(record).digest();
    if (timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

/** Rechecks the durable TXT proof immediately before a future Deep Audit run. */
export async function revalidateDeepAuditAuthorization(input: {
  siteId: string;
  organizationId: string;
  resolveTxt?: TxtResolver;
  signal?: AbortSignal;
}): Promise<AuthorizationDecision> {
  const { db } = getDatabase();
  if (input.signal?.aborted) throw abortError();
  const [row] = await db
    .select({ site: sites, grant: deepAuditAuthorizations })
    .from(sites)
    .leftJoin(
      deepAuditAuthorizations,
      eq(deepAuditAuthorizations.siteId, sites.id),
    )
    .where(
      and(
        eq(sites.id, input.siteId),
        eq(sites.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (input.signal?.aborted) throw abortError();
  if (!row) return { allowed: false, reason: "site-inactive" };
  if (row.site.status !== "active")
    return { allowed: false, reason: "site-inactive" };
  if (!row.site.verifiedAt)
    return { allowed: false, reason: "site-unverified" };
  const siteVerifiedAt = row.site.verifiedAt;
  const grant = row.grant;
  if (!grant) {
    return db.transaction(async (tx) => {
      if (input.signal?.aborted) throw abortError();
      const [currentSite] = await tx
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
        !currentSite ||
        currentSite.status !== "active" ||
        !currentSite.verifiedAt
      ) {
        return { allowed: false, reason: "site-inactive" } as const;
      }
      if (
        currentSite.canonicalUrl !== row.site.canonicalUrl ||
        currentSite.verifiedAt.getTime() !== siteVerifiedAt.getTime()
      ) {
        return { allowed: false, reason: "deep-grant-invalid" } as const;
      }
      const decision = authorizeScan({
        mode: "verified_deep_audit",
        siteId: input.siteId,
        siteStatus: currentSite.status,
        verifiedAt: currentSite.verifiedAt,
        now: new Date(),
      });
      return decision.allowed
        ? {
            ...decision,
            grantIdentity: {
              canonicalUrl: currentSite.canonicalUrl,
              siteVerifiedAt: currentSite.verifiedAt,
            },
          }
        : decision;
    });
  }
  if (grant.revokedAt) return { allowed: false, reason: "deep-grant-revoked" };
  if (grant.expiresAt <= new Date())
    return { allowed: false, reason: "deep-grant-expired" };

  let recordName: string;
  try {
    recordName = expectedDeepProofRecord(row.site.canonicalUrl);
  } catch {
    return { allowed: false, reason: "deep-grant-invalid" };
  }
  if (
    grant.proofType !== "dns_txt" ||
    !grant.generationId ||
    grant.proofRecordName !== recordName ||
    !/^[a-f0-9]{64}$/.test(grant.proofTokenHash ?? "")
  ) {
    return { allowed: false, reason: "deep-grant-invalid" };
  }
  if (input.signal?.aborted) throw abortError();

  let valid = false;
  let timer: NodeJS.Timeout | undefined;
  const resolver = input.resolveTxt ? undefined : new Resolver();
  let onAbort: (() => void) | undefined;
  try {
    const answers = await Promise.race([
      (input.resolveTxt ?? ((name) => resolver!.resolveTxt(name)))(recordName),
      new Promise<never>(
        (_, reject) =>
          (timer = setTimeout(
            () => reject(new Error("DNS proof timeout")),
            5_000,
          )),
      ),
      new Promise<never>((_, reject) => {
        onAbort = () => {
          resolver?.cancel();
          reject(abortError());
        };
        input.signal?.addEventListener("abort", onAbort, { once: true });
        if (input.signal?.aborted) onAbort();
      }),
    ]);
    valid = matchesDeepProof(answers, grant.proofTokenHash!);
  } catch {
    if (input.signal?.aborted) throw abortError();
    valid = false;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) input.signal?.removeEventListener("abort", onAbort);
  }
  // DNS may take five seconds. Lock and re-read both rows with a fresh DB clock.
  return db.transaction(async (tx) => {
    if (input.signal?.aborted) throw abortError();
    const [currentSite] = await tx
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
    if (input.signal?.aborted) throw abortError();
    if (
      !currentSite ||
      currentSite.status !== "active" ||
      !currentSite.verifiedAt
    )
      return { allowed: false, reason: "site-inactive" } as const;
    const [currentGrant] = await tx
      .select()
      .from(deepAuditAuthorizations)
      .where(eq(deepAuditAuthorizations.siteId, input.siteId))
      .for("update")
      .limit(1);
    if (input.signal?.aborted) throw abortError();
    const [clock] = await tx
      .select({ now: sql<Date>`clock_timestamp()`.mapWith(sites.createdAt) })
      .from(sites)
      .where(eq(sites.id, input.siteId))
      .limit(1);
    if (input.signal?.aborted) throw abortError();
    if (
      !valid &&
      currentGrant?.proofTokenHash === grant.proofTokenHash &&
      currentGrant?.generationId === grant.generationId &&
      currentGrant?.proofVerifiedAt.getTime() ===
        grant.proofVerifiedAt.getTime()
    ) {
      await tx
        .update(deepAuditAuthorizations)
        .set({ revalidatedAt: null })
        .where(eq(deepAuditAuthorizations.siteId, input.siteId));
    }
    if (
      !clock ||
      !currentGrant ||
      !valid ||
      currentGrant.proofType !== "dns_txt" ||
      currentSite.canonicalUrl !== row.site.canonicalUrl ||
      !row.site.verifiedAt ||
      currentSite.verifiedAt.getTime() !== row.site.verifiedAt.getTime() ||
      currentGrant.proofRecordName !== recordName ||
      currentGrant.proofRecordName !==
        expectedDeepProofRecord(currentSite.canonicalUrl) ||
      currentGrant.proofTokenHash !== grant.proofTokenHash ||
      !currentGrant.generationId ||
      currentGrant.generationId !== grant.generationId ||
      currentGrant.proofVerifiedAt.getTime() !==
        grant.proofVerifiedAt.getTime() ||
      currentGrant.revokedAt ||
      currentGrant.expiresAt <= clock.now
    )
      return { allowed: false, reason: "deep-grant-invalid" } as const;
    const [updated] = await tx
      .update(deepAuditAuthorizations)
      .set({ revalidatedAt: clock.now })
      .where(eq(deepAuditAuthorizations.siteId, input.siteId))
      .returning();
    if (input.signal?.aborted) throw abortError();
    if (!updated || !updated.generationId)
      return { allowed: false, reason: "deep-grant-invalid" } as const;
    const decision = authorizeScan({
      mode: "verified_deep_audit",
      siteId: input.siteId,
      siteStatus: currentSite.status,
      verifiedAt: currentSite.verifiedAt,
      deepGrant: { ...updated, proofType: "dns_txt" },
      now: clock.now,
    });
    return decision.allowed
      ? {
          ...decision,
          grantIdentity: {
            generationId: updated.generationId,
            tokenHash: updated.proofTokenHash!,
            verifiedAt: updated.proofVerifiedAt,
            canonicalUrl: currentSite.canonicalUrl,
            siteVerifiedAt: currentSite.verifiedAt,
          },
        }
      : decision;
  });
}
