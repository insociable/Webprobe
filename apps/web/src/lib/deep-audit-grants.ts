import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Resolver } from "node:dns/promises";
import {
  deepAuditAuthorizations,
  deepAuditChallenges,
  memberships,
  scanAttempts,
  scans,
  sites,
} from "@agency-saas/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  OrganizationAccessError,
} from "./organization-site-service";

const CHALLENGE_TTL_MS = 15 * 60_000;
const GRANT_TTL_MS = 24 * 60 * 60_000;
const DNS_TIMEOUT_MS = 5_000;

export type DeepTxtResolver = (name: string) => Promise<string[][]>;

function recordName(canonicalUrl: string): string {
  const url = new URL(canonicalUrl);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Invalid site URL");
  return `_agency-monitor.${url.hostname.replace(/\.$/, "").toLowerCase()}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function matchesDeepChallenge(
  answers: readonly (readonly string[])[],
  expectedHash: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || answers.length > 32) return false;
  const expected = Buffer.from(expectedHash, "hex");
  for (const fragments of answers) {
    const token = fragments.join("");
    if (token.length > 1024) return false;
    if (timingSafeEqual(Buffer.from(hashToken(token), "hex"), expected))
      return true;
  }
  return false;
}

async function requireManager(
  executor: Pick<typeof db, "select">,
  userId: string,
  organizationId: string,
): Promise<void> {
  const [membership] = await executor
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, organizationId),
      ),
    )
    .for("share")
    .limit(1);
  if (!membership || !canManageOrganization(membership.role))
    throw new OrganizationAccessError(
      "Only organization owners and admins can manage Deep Audit grants",
    );
}

async function lockedSite(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  siteId: string,
  requireActive = true,
) {
  const [site] = await tx
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.organizationId, organizationId)))
    .for("update")
    .limit(1);
  if (
    !site ||
    (requireActive && (site.status !== "active" || !site.verifiedAt))
  )
    throw new Error("Active verified site required");
  return site;
}

async function databaseNow(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  siteId: string,
) {
  const [clock] = await tx
    .select({ now: sql<Date>`clock_timestamp()` })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!clock) throw new Error("Site unavailable");
  return clock.now;
}

async function fenceRunningDeepAttempts(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  siteId: string,
  now: Date,
) {
  await tx
    .update(scanAttempts)
    .set({ leaseUntil: now })
    .where(
      and(
        eq(scanAttempts.status, "running"),
        inArray(
          scanAttempts.scanId,
          tx
            .select({ id: scans.id })
            .from(scans)
            .where(
              and(
                eq(scans.siteId, siteId),
                eq(scans.scanMode, "verified_deep_audit"),
              ),
            ),
        ),
      ),
    );
}

/** Returns the TXT token once. Only its SHA-256 hash is stored. Rotation revokes the old grant. */
export async function issueDeepAuditChallenge(input: {
  userId: string;
  organizationId: string;
  siteId: string;
}) {
  const token = `agency-monitor-deep=${randomBytes(32).toString("base64url")}`;
  const tokenHash = hashToken(token);
  const generationId = randomUUID();
  return db.transaction(async (tx) => {
    const site = await lockedSite(tx, input.organizationId, input.siteId);
    await requireManager(tx, input.userId, input.organizationId);
    const now = await databaseNow(tx, input.siteId);
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const name = recordName(site.canonicalUrl);
    await tx
      .insert(deepAuditChallenges)
      .values({
        siteId: input.siteId,
        organizationId: input.organizationId,
        generationId,
        tokenHash,
        recordName: name,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: deepAuditChallenges.siteId,
        set: {
          organizationId: input.organizationId,
          generationId,
          tokenHash,
          recordName: name,
          expiresAt,
          updatedAt: now,
        },
      });
    await tx
      .update(deepAuditAuthorizations)
      .set({ revokedAt: now, revalidatedAt: null })
      .where(eq(deepAuditAuthorizations.siteId, input.siteId));
    await fenceRunningDeepAttempts(tx, input.siteId, now);
    return { recordName: name, token, expiresAt };
  });
}

/** DNS is resolved outside the transaction, then every mutable prerequisite is rechecked under locks. */
export async function verifyDeepAuditChallenge(
  input: { userId: string; organizationId: string; siteId: string },
  resolveTxt?: DeepTxtResolver,
) {
  await requireManager(db, input.userId, input.organizationId);
  const [challenge] = await db
    .select()
    .from(deepAuditChallenges)
    .where(
      and(
        eq(deepAuditChallenges.siteId, input.siteId),
        eq(deepAuditChallenges.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!challenge) throw new Error("Deep challenge unavailable");
  const resolver = resolveTxt ? undefined : new Resolver();
  let timer: NodeJS.Timeout | undefined;
  let answers: string[][];
  try {
    answers = await Promise.race([
      (resolveTxt ?? ((name) => resolver!.resolveTxt(name)))(
        challenge.recordName,
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          resolver?.cancel();
          reject(new Error("Deep DNS proof timed out"));
        }, DNS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!matchesDeepChallenge(answers, challenge.tokenHash))
    throw new Error("Deep DNS proof not found");
  return db.transaction(async (tx) => {
    const site = await lockedSite(tx, input.organizationId, input.siteId);
    await requireManager(tx, input.userId, input.organizationId);
    const [current] = await tx
      .select()
      .from(deepAuditChallenges)
      .where(
        and(
          eq(deepAuditChallenges.siteId, input.siteId),
          eq(deepAuditChallenges.organizationId, input.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    const now = await databaseNow(tx, input.siteId);
    if (
      !current ||
      current.generationId !== challenge.generationId ||
      current.tokenHash !== challenge.tokenHash ||
      current.recordName !== challenge.recordName ||
      current.recordName !== recordName(site.canonicalUrl) ||
      current.expiresAt <= now
    )
      throw new Error("Deep challenge changed or expired");
    const expiresAt = new Date(now.getTime() + GRANT_TTL_MS);
    await tx
      .insert(deepAuditAuthorizations)
      .values({
        siteId: input.siteId,
        proofType: "dns_txt",
        proofRecordName: current.recordName,
        proofTokenHash: current.tokenHash,
        generationId: current.generationId,
        proofVerifiedAt: now,
        revalidatedAt: null,
        expiresAt,
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: deepAuditAuthorizations.siteId,
        set: {
          proofType: "dns_txt",
          proofRecordName: current.recordName,
          proofTokenHash: current.tokenHash,
          generationId: current.generationId,
          proofVerifiedAt: now,
          revalidatedAt: null,
          expiresAt,
          revokedAt: null,
        },
      });
    await tx
      .delete(deepAuditChallenges)
      .where(eq(deepAuditChallenges.siteId, input.siteId));
    return { generationId: current.generationId, expiresAt };
  });
}

/** Revocation fences persistence immediately and aborts traffic at its next guarded boundary. */
export async function revokeDeepAuditGrant(input: {
  userId: string;
  organizationId: string;
  siteId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await lockedSite(tx, input.organizationId, input.siteId, false);
    await requireManager(tx, input.userId, input.organizationId);
    const now = await databaseNow(tx, input.siteId);
    await tx
      .update(deepAuditAuthorizations)
      .set({ revokedAt: now, revalidatedAt: null })
      .where(eq(deepAuditAuthorizations.siteId, input.siteId));
    await tx
      .delete(deepAuditChallenges)
      .where(
        and(
          eq(deepAuditChallenges.siteId, input.siteId),
          eq(deepAuditChallenges.organizationId, input.organizationId),
        ),
      );
    await fenceRunningDeepAttempts(tx, input.siteId, now);
  });
}
