import { scanCheckRuns, scans } from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "../database.js";
import { BudgetLedger } from "./budget-ledger.js";
import type { CheckRun } from "./engine.js";

/** Persists one candidate Deep Audit attempt atomically, without touching V2 results. */
export async function persistDeepCheckRuns(input: {
  scanId: string;
  organizationId: string;
  siteId: string;
  runs: readonly CheckRun[];
  ledger: BudgetLedger;
}): Promise<void> {
  if (input.runs.length === 0) throw new Error("No check runs to persist");
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
  });
}
