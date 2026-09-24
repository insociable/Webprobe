import { BudgetLedger } from "./budget-ledger.js";
import type { AuthorizationDecision } from "./authorization.js";
import { type CheckDefinition, CheckRegistry } from "./check-registry.js";
import { createEvidence, type CheckEvidence } from "./evidence.js";
import { ScopeGuard } from "./scope-guard.js";
import type { ScanProfile } from "./types.js";

export type CheckRun = {
  checkId: string;
  checkVersion: string;
  status: "completed" | "skipped" | "failed";
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  budgetUsed: Record<string, number>;
  skipReason: string | null;
  evidence: readonly CheckEvidence[];
};

function mayRun(check: CheckDefinition, profile: ScanProfile): string | null {
  if (!check.modes.includes(profile.mode)) return "not-applicable";
  if (!profile.allowedChecks.includes(check.id)) {
    return "profile-denied";
  }
  if (check.activity === "active_safe" && !profile.allowActiveSafe) {
    return "active-safe-denied";
  }
  if (
    check.authorization === "deep" &&
    profile.mode !== "verified_deep_audit"
  ) {
    return "authorization-denied";
  }
  if (check.authorization === "verified" && profile.mode === "public_audit") {
    return "authorization-denied";
  }
  return null;
}

/** Runs analysis over already collected observations. This API exposes no transport. */
export async function runChecks(input: {
  profile: ScanProfile;
  registry: CheckRegistry;
  ledger: BudgetLedger;
  scope: ScopeGuard;
  authorization: AuthorizationDecision;
  targetUrl: string;
  observations: Readonly<Record<string, unknown>>;
  now?: () => number;
  signal?: AbortSignal;
}): Promise<readonly CheckRun[]> {
  const now = input.now ?? Date.now;
  const scopeAllowed = input.scope.allows(input.targetUrl).allowed;
  const authorizationAllowed = !(
    !input.authorization.allowed ||
    (input.profile.mode === "verified_deep_audit" &&
      input.authorization.level !== "deep") ||
    (input.profile.mode === "verified_monitoring" &&
      input.authorization.level === "public")
  );
  if (!scopeAllowed) input.ledger.markPartial("scope-denied");
  if (!authorizationAllowed)
    input.ledger.markPartial("authorization-unavailable");
  const runs: CheckRun[] = [];
  for (const check of input.registry.listAll()) {
    const startedAtMs = now();
    let skipReason = input.signal?.aborted
      ? "scan-interrupted"
      : !scopeAllowed
        ? "scope-denied"
        : !authorizationAllowed
          ? "authorization-unavailable"
          : mayRun(check, input.profile);
    const before = input.ledger.snapshot().used;
    if (!skipReason) {
      const time = input.ledger.checkTime();
      if (!time.allowed) skipReason = time.reason;
    }
    if (!skipReason) {
      const reservation = input.ledger.reserveMany(
        check.budget,
        new URL(input.targetUrl).hostname,
      );
      if (!reservation.allowed) skipReason = reservation.reason;
    }
    let status: CheckRun["status"] = skipReason ? "skipped" : "completed";
    let evidence: readonly CheckEvidence[] = [];
    if (!skipReason) {
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      try {
        evidence = (
          await Promise.race([
            check.analyze(input.observations, controller.signal),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error("check-timeout"));
              }, check.timeoutMs);
            }),
          ])
        ).map(createEvidence);
        if (
          evidence.some(
            (item) =>
              item.checkId !== check.id || item.checkVersion !== check.version,
          )
        ) {
          throw new Error("Check evidence identity mismatch");
        }
      } catch (error) {
        status = "failed";
        skipReason =
          error instanceof Error && error.message === "check-timeout"
            ? "check-timeout"
            : "check-failed";
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const after = input.ledger.snapshot().used;
    runs.push({
      checkId: check.id,
      checkVersion: check.version,
      status,
      startedAt: new Date(startedAtMs),
      completedAt: new Date(now()),
      durationMs: Math.max(0, now() - startedAtMs),
      budgetUsed: Object.fromEntries(
        Object.entries(after).map(([kind, value]) => [
          kind,
          value - before[kind as keyof typeof before],
        ]),
      ),
      skipReason,
      evidence,
    });
  }
  return runs;
}
