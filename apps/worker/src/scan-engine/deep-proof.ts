import { createHash, timingSafeEqual } from "node:crypto";
import { resolveTxt as systemResolveTxt } from "node:dns/promises";
import { deepAuditAuthorizations, sites } from "@agency-saas/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDatabase } from "../database.js";
import { authorizeScan, type AuthorizationDecision } from "./authorization.js";

export type TxtResolver = (name: string) => Promise<string[][]>;

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
  now?: Date;
  resolveTxt?: TxtResolver;
}): Promise<AuthorizationDecision> {
  const { db } = getDatabase();
  const now = input.now ?? new Date();
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
  if (!row) return { allowed: false, reason: "site-inactive" };
  if (row.site.status !== "active")
    return { allowed: false, reason: "site-inactive" };
  if (!row.site.verifiedAt)
    return { allowed: false, reason: "site-unverified" };
  const grant = row.grant;
  if (!grant) return { allowed: false, reason: "deep-grant-missing" };
  if (grant.revokedAt) return { allowed: false, reason: "deep-grant-revoked" };
  if (grant.expiresAt <= now)
    return { allowed: false, reason: "deep-grant-expired" };

  let recordName: string;
  try {
    recordName = expectedDeepProofRecord(row.site.canonicalUrl);
  } catch {
    return { allowed: false, reason: "deep-grant-invalid" };
  }
  if (
    grant.proofType !== "dns_txt" ||
    grant.proofRecordName !== recordName ||
    !/^[a-f0-9]{64}$/.test(grant.proofTokenHash ?? "")
  ) {
    return { allowed: false, reason: "deep-grant-invalid" };
  }

  let valid = false;
  let timer: NodeJS.Timeout | undefined;
  try {
    const answers = await Promise.race([
      (input.resolveTxt ?? systemResolveTxt)(recordName),
      new Promise<never>(
        (_, reject) =>
          (timer = setTimeout(
            () => reject(new Error("DNS proof timeout")),
            5_000,
          )),
      ),
    ]);
    valid = matchesDeepProof(answers, grant.proofTokenHash!);
  } catch {
    valid = false;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const [updated] = await db
    .update(deepAuditAuthorizations)
    .set({ revalidatedAt: valid ? now : null })
    .where(
      and(
        eq(deepAuditAuthorizations.siteId, input.siteId),
        eq(deepAuditAuthorizations.proofRecordName, recordName),
        eq(deepAuditAuthorizations.proofTokenHash, grant.proofTokenHash!),
        isNull(deepAuditAuthorizations.revokedAt),
        gt(deepAuditAuthorizations.expiresAt, now),
      ),
    )
    .returning();
  if (!valid || !updated)
    return { allowed: false, reason: "deep-grant-invalid" };
  const [currentSite] = await db
    .select({
      status: sites.status,
      verifiedAt: sites.verifiedAt,
      canonicalUrl: sites.canonicalUrl,
    })
    .from(sites)
    .where(
      and(
        eq(sites.id, input.siteId),
        eq(sites.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (
    !currentSite ||
    currentSite.status !== "active" ||
    !currentSite.verifiedAt
  ) {
    return { allowed: false, reason: "site-inactive" };
  }
  let currentRecordName: string;
  try {
    currentRecordName = expectedDeepProofRecord(currentSite.canonicalUrl);
  } catch {
    return { allowed: false, reason: "deep-grant-invalid" };
  }
  if (currentRecordName !== recordName) {
    return { allowed: false, reason: "deep-grant-invalid" };
  }
  return authorizeScan({
    mode: "verified_deep_audit",
    siteId: input.siteId,
    siteStatus: currentSite.status,
    verifiedAt: currentSite.verifiedAt,
    deepGrant: {
      ...updated,
      proofType: "dns_txt",
    },
    now,
  });
}
