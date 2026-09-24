import {
  deepAuditAuthorizations,
  scanAttempts,
  scanCheckRuns,
  scans,
  sites,
} from "@agency-saas/db";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "../database.js";
import { BudgetLedger } from "./budget-ledger.js";
import type { CheckRun } from "./engine.js";
import type { DeepGrantIdentity, DeepLease } from "./deep-lease.js";
import { expectedDeepProofRecord } from "./deep-proof.js";

/** Persists and completes one fenced Deep attempt atomically, without touching V2 results. */
export async function persistDeepCheckRuns(input: {
  scanId: string;
  organizationId: string;
  siteId: string;
  targetUrl: string;
  runs: readonly CheckRun[];
  ledger: BudgetLedger;
  lease: DeepLease;
  grantIdentity: DeepGrantIdentity | null;
  signal?: AbortSignal;
}): Promise<void> {
  if (input.signal?.aborted) throw new Error("Deep execution aborted");
  if (input.runs.length === 0) throw new Error("No check runs to persist");
  if (
    !input.grantIdentity &&
    input.runs.some(
      (run) =>
        run.status !== "skipped" ||
        run.skipReason !== "authorization-unavailable",
    )
  )
    throw new Error("Deep grant missing for check results");
  const identities = input.runs.map(
    (run) => `${run.checkId}\0${run.checkVersion}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw new Error("Duplicate check runs");
  }
  const coverage = input.ledger.snapshot();
  const reasons = new Set<string>(coverage.reasons);
  for (const run of input.runs) {
    if (run.status !== "completed")
      reasons.add(run.skipReason ?? "check-failed");
    if (
      !Number.isSafeInteger(run.durationMs) ||
      run.durationMs < 0 ||
      run.completedAt < run.startedAt ||
      run.evidence.some(
        (item) =>
          item.checkId !== run.checkId ||
          item.checkVersion !== run.checkVersion,
      )
    ) {
      throw new Error("Invalid check run");
    }
  }

  const { db } = getDatabase();
  await db.transaction(async (tx) => {
    const [scan] = await tx
      .select({
        mode: scans.scanMode,
        status: scans.status,
        summary: scans.summary,
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
      scan.mode !== "verified_deep_audit" ||
      scan.status !== "running"
    ) {
      throw new Error("Deep scan is not running for this site");
    }
    const [attempt] = await tx
      .select({ id: scanAttempts.id })
      .from(scanAttempts)
      .where(
        and(
          eq(scanAttempts.id, input.lease.attemptId),
          eq(scanAttempts.scanId, input.scanId),
          eq(scanAttempts.leaseToken, input.lease.token),
          eq(scanAttempts.status, "running"),
          sql`${scanAttempts.leaseUntil} > clock_timestamp()`,
        ),
      )
      .limit(1);
    if (!attempt || input.signal?.aborted)
      throw new Error("Deep execution lease lost");
    // Keep the site and grant locked through commit so a revocation, site pause,
    // or grant generation change cannot race the final write.
    const [site] = await tx
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
      .for("update")
      .limit(1);
    if (
      !site ||
      site.status !== "active" ||
      !site.verifiedAt ||
      site.canonicalUrl !== input.targetUrl
    )
      throw new Error("Deep site changed before persistence");
    if (input.grantIdentity) {
      const [grant] = await tx
        .select()
        .from(deepAuditAuthorizations)
        .where(eq(deepAuditAuthorizations.siteId, input.siteId))
        .for("update")
        .limit(1);
      const [clock] = await tx
        .select({ now: sql<Date>`clock_timestamp()`.mapWith(scans.queuedAt) })
        .from(scans)
        .where(eq(scans.id, input.scanId))
        .limit(1);
      if (
        !grant ||
        !clock ||
        site.canonicalUrl !== input.grantIdentity.canonicalUrl ||
        site.verifiedAt.getTime() !==
          input.grantIdentity.siteVerifiedAt.getTime() ||
        grant.proofType !== "dns_txt" ||
        grant.proofRecordName !== expectedDeepProofRecord(site.canonicalUrl) ||
        grant.proofTokenHash !== input.grantIdentity.tokenHash ||
        grant.generationId !== input.grantIdentity.generationId ||
        grant.proofVerifiedAt.getTime() !==
          input.grantIdentity.verifiedAt.getTime() ||
        grant.expiresAt <= clock.now ||
        grant.revokedAt ||
        input.signal?.aborted
      ) {
        throw new Error("Deep grant changed before persistence");
      }
    }
    const prior = await tx
      .select({ id: scanCheckRuns.id })
      .from(scanCheckRuns)
      .where(eq(scanCheckRuns.scanId, input.scanId))
      .limit(1);
    if (prior.length) throw new Error("Check runs already persisted");

    await tx.insert(scanCheckRuns).values(
      input.runs.map((run) => ({
        scanId: input.scanId,
        checkId: run.checkId,
        checkVersion: run.checkVersion,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        budgetUsed: run.budgetUsed,
        skipReason: run.skipReason,
        evidence: run.evidence.map((item) => ({ ...item })),
      })),
    );
    await tx
      .update(scans)
      .set({
        status: "completed",
        completedAt: sql`clock_timestamp()`,
        summary: {
          ...scan.summary,
          v3Coverage: {
            totalChecks: input.runs.length,
            completedChecks: input.runs.filter(
              (run) => run.status === "completed",
            ).length,
            skippedChecks: input.runs.filter((run) => run.status === "skipped")
              .length,
            failedChecks: input.runs.filter((run) => run.status === "failed")
              .length,
            partial: reasons.size > 0,
            reasons: [...reasons],
            budgetUsed: coverage.used,
          },
        },
      })
      .where(eq(scans.id, input.scanId));
    const [completed] = await tx
      .update(scanAttempts)
      .set({
        status: "completed",
        retryable: false,
        errorCode: null,
        completedAt: sql`clock_timestamp()`,
        leaseUntil: null,
      })
      .where(
        and(
          eq(scanAttempts.id, input.lease.attemptId),
          eq(scanAttempts.leaseToken, input.lease.token),
          eq(scanAttempts.status, "running"),
          sql`${scanAttempts.leaseUntil} > clock_timestamp()`,
        ),
      )
      .returning({ id: scanAttempts.id });
    if (!completed || input.signal?.aborted)
      throw new Error("Deep execution lease lost");
  });
}
