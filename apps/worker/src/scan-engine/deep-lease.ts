import { randomUUID } from "node:crypto";
import {
  deepAuditAuthorizations,
  scanAttempts,
  scanCheckRuns,
  scans,
  sites,
} from "@agency-saas/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "../database.js";
import { expectedDeepProofRecord } from "./deep-proof.js";

const LEASE_MS = 30_000;
const RENEW_MS = 5_000;
const MAX_DEEP_ATTEMPTS = 5;

export type DeepLease = Readonly<{
  scanId: string;
  attemptId: string;
  attemptNumber: number;
  token: string;
  organizationId: string;
  siteId: string;
}>;

export type DeepGrantIdentity = Readonly<{
  generationId: string | null;
  tokenHash: string;
  verifiedAt: Date;
  canonicalUrl: string;
  siteVerifiedAt: Date;
}>;

export type DeepLeaseMonitor = {
  signal: AbortSignal;
  setGrant(identity: DeepGrantIdentity): void;
  assertCurrent(): Promise<void>;
  stop(): void;
};

export class DeepLeaseError extends Error {
  constructor(message = "Deep execution lease unavailable") {
    super(message);
    this.name = "DeepLeaseError";
  }
}

/** The scan row serializes competing claims; the attempt token fences stale writers. */
export async function claimDeepLease(input: {
  scanId: string;
  organizationId: string;
  siteId: string;
}): Promise<DeepLease> {
  const { db } = getDatabase();
  return db.transaction(async (tx) => {
    const [scan] = await tx
      .select({
        id: scans.id,
        status: scans.status,
        mode: scans.scanMode,
      })
      .from(scans)
      .where(
        and(
          eq(scans.id, input.scanId),
          eq(scans.organizationId, input.organizationId),
          eq(scans.siteId, input.siteId),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !scan ||
      scan.status !== "running" ||
      scan.mode !== "verified_deep_audit"
    )
      throw new DeepLeaseError("Deep scan is not running for this site");
    const prior = await tx
      .select({ id: scanCheckRuns.id })
      .from(scanCheckRuns)
      .where(eq(scanCheckRuns.scanId, input.scanId))
      .limit(1);
    if (prior.length) throw new DeepLeaseError("Check runs already persisted");
    const [clock] = await tx
      .select({ now: sql<Date>`clock_timestamp()` })
      .from(scans)
      .where(eq(scans.id, input.scanId))
      .limit(1);
    if (!clock) throw new DeepLeaseError();
    const [latest] = await tx
      .select()
      .from(scanAttempts)
      .where(eq(scanAttempts.scanId, input.scanId))
      .orderBy(desc(scanAttempts.attemptNumber))
      .limit(1);
    if (latest?.status === "running") {
      // Null denotes a legacy, unfenced attempt. Never steal it.
      if (!latest.leaseUntil || latest.leaseUntil > clock.now)
        throw new DeepLeaseError("Deep execution lease is active or ambiguous");
      const [expired] = await tx
        .update(scanAttempts)
        .set({
          status: "retrying",
          retryable: true,
          errorCode: "deep-lease-expired",
          completedAt: clock.now,
          leaseUntil: null,
        })
        .where(
          and(
            eq(scanAttempts.id, latest.id),
            eq(scanAttempts.status, "running"),
            sql`${scanAttempts.leaseUntil} <= clock_timestamp()`,
          ),
        )
        .returning({ id: scanAttempts.id });
      if (!expired)
        throw new DeepLeaseError("Deep lease was renewed concurrently");
    }
    if (
      latest?.status === "completed" ||
      (latest?.attemptNumber ?? 0) >= MAX_DEEP_ATTEMPTS
    )
      throw new DeepLeaseError("Deep execution cannot be retried");
    const token = randomUUID();
    const [attempt] = await tx
      .insert(scanAttempts)
      .values({
        scanId: input.scanId,
        attemptNumber: (latest?.attemptNumber ?? 0) + 1,
        status: "running",
        startedAt: clock.now,
        leaseToken: token,
        leaseUntil: new Date(clock.now.getTime() + LEASE_MS),
      })
      .returning({
        id: scanAttempts.id,
        attemptNumber: scanAttempts.attemptNumber,
      });
    if (!attempt) throw new DeepLeaseError();
    return {
      scanId: input.scanId,
      organizationId: input.organizationId,
      siteId: input.siteId,
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      token,
    };
  });
}

/** A fresh database-time read before network and during heartbeat; failures deny execution. */
export async function assertDeepLease(
  lease: DeepLease,
  grant?: DeepGrantIdentity,
): Promise<void> {
  const { db } = getDatabase();
  const [row] = await db
    .select({
      scanStatus: scans.status,
      scanMode: scans.scanMode,
      attemptStatus: scanAttempts.status,
      leaseUntil: scanAttempts.leaseUntil,
      leaseToken: scanAttempts.leaseToken,
      siteStatus: sites.status,
      siteVerifiedAt: sites.verifiedAt,
      canonicalUrl: sites.canonicalUrl,
      proofType: deepAuditAuthorizations.proofType,
      recordName: deepAuditAuthorizations.proofRecordName,
      tokenHash: deepAuditAuthorizations.proofTokenHash,
      generationId: deepAuditAuthorizations.generationId,
      proofVerifiedAt: deepAuditAuthorizations.proofVerifiedAt,
      expiresAt: deepAuditAuthorizations.expiresAt,
      revokedAt: deepAuditAuthorizations.revokedAt,
      now: sql<Date>`clock_timestamp()`,
    })
    .from(scans)
    .innerJoin(scanAttempts, eq(scanAttempts.scanId, scans.id))
    .innerJoin(sites, eq(sites.id, scans.siteId))
    .leftJoin(
      deepAuditAuthorizations,
      eq(deepAuditAuthorizations.siteId, sites.id),
    )
    .where(
      and(
        eq(scans.id, lease.scanId),
        eq(scans.organizationId, lease.organizationId),
        eq(scans.siteId, lease.siteId),
        eq(scanAttempts.id, lease.attemptId),
        eq(scanAttempts.leaseToken, lease.token),
      ),
    )
    .limit(1);
  if (
    !row ||
    row.scanStatus !== "running" ||
    row.scanMode !== "verified_deep_audit" ||
    row.attemptStatus !== "running" ||
    !row.leaseUntil ||
    row.leaseUntil <= row.now ||
    row.leaseToken !== lease.token
  )
    throw new DeepLeaseError();
  if (row.siteStatus !== "active" || !row.siteVerifiedAt)
    throw new DeepLeaseError("Deep site is inactive or unverified");
  if (grant) {
    if (
      row.canonicalUrl !== grant.canonicalUrl ||
      row.siteVerifiedAt.getTime() !== grant.siteVerifiedAt.getTime() ||
      row.proofType !== "dns_txt" ||
      row.recordName !== expectedDeepProofRecord(row.canonicalUrl) ||
      row.tokenHash !== grant.tokenHash ||
      row.generationId !== grant.generationId ||
      row.proofVerifiedAt?.getTime() !== grant.verifiedAt.getTime() ||
      !row.expiresAt ||
      row.expiresAt <= row.now ||
      row.revokedAt
    )
      throw new DeepLeaseError("Deep authorization changed or expired");
  }
}

export async function renewDeepLease(
  lease: DeepLease,
  grant?: DeepGrantIdentity,
): Promise<void> {
  await assertDeepLease(lease, grant);
  const { db } = getDatabase();
  const [renewed] = await db
    .update(scanAttempts)
    .set({
      leaseUntil: sql`clock_timestamp() + interval '30 seconds'`,
    })
    .where(
      and(
        eq(scanAttempts.id, lease.attemptId),
        eq(scanAttempts.leaseToken, lease.token),
        eq(scanAttempts.status, "running"),
        sql`${scanAttempts.leaseUntil} > clock_timestamp()`,
      ),
    )
    .returning({ id: scanAttempts.id });
  if (!renewed) throw new DeepLeaseError();
}

export async function releaseDeepLease(lease: DeepLease): Promise<void> {
  const { db } = getDatabase();
  await db
    .update(scanAttempts)
    .set({
      status: "retrying",
      retryable: true,
      errorCode: "deep-interrupted",
      completedAt: sql`clock_timestamp()`,
      leaseUntil: null,
    })
    .where(
      and(
        eq(scanAttempts.id, lease.attemptId),
        eq(scanAttempts.leaseToken, lease.token),
        eq(scanAttempts.status, "running"),
      ),
    );
}

/** Renewal is deliberately sparse; any failed renewal immediately aborts all transports. */
export function monitorDeepLease(
  lease: DeepLease,
  external?: AbortSignal,
): DeepLeaseMonitor {
  const controller = new AbortController();
  let grant: DeepGrantIdentity | undefined;
  let stopped = false;
  let renewing = false;
  const abort = () => controller.abort();
  let localDeadline = Date.now() + LEASE_MS - RENEW_MS;
  let deadlineTimer: NodeJS.Timeout | undefined;
  const armDeadline = () => {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    localDeadline = Date.now() + LEASE_MS - RENEW_MS;
    deadlineTimer = setTimeout(abort, LEASE_MS - RENEW_MS);
    deadlineTimer.unref();
  };
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) abort();
  armDeadline();
  const timer = setInterval(() => {
    if (stopped || renewing || controller.signal.aborted) return;
    renewing = true;
    void renewDeepLease(lease, grant)
      .then(() => {
        if (!stopped && !controller.signal.aborted) armDeadline();
      })
      .catch(abort)
      .finally(() => {
        renewing = false;
      });
  }, RENEW_MS);
  timer.unref();
  return {
    signal: controller.signal,
    setGrant(identity: DeepGrantIdentity) {
      grant = identity;
    },
    async assertCurrent() {
      if (Date.now() >= localDeadline) abort();
      if (controller.signal.aborted)
        throw new DeepLeaseError("Deep execution aborted");
      try {
        await assertDeepLease(lease, grant);
      } catch (error) {
        abort();
        throw error;
      }
      if (controller.signal.aborted)
        throw new DeepLeaseError("Deep execution aborted");
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      external?.removeEventListener("abort", abort);
      abort();
    },
  };
}
