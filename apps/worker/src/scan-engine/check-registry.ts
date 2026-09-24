import type { CheckEvidence } from "./evidence.js";
import type { BudgetKind, ScanMode } from "./types.js";

export type CheckDefinition = Readonly<{
  id: string;
  version: string;
  category: string;
  authorization: "public" | "verified" | "deep";
  activity: "passive" | "active_safe";
  modes: readonly ScanMode[];
  budget: Partial<Record<BudgetKind, number>>;
  requiredObservations?: readonly string[];
  timeoutMs: number;
  analyze: (
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ) => Promise<readonly CheckEvidence[]>;
  remediation: string | null;
}>;

/** Checks receive collected data only. Network access belongs to the guarded transport. */
export class CheckRegistry {
  private readonly checks = new Map<string, CheckDefinition>();

  register(check: CheckDefinition): void {
    if (
      !/^[a-z][a-z0-9-]{1,79}$/.test(check.id) ||
      !/^\d+\.\d+\.\d+$/.test(check.version)
    ) {
      throw new Error("Invalid check identity");
    }
    if (this.checks.has(check.id)) throw new Error("Duplicate check ID");
    if (
      !Number.isSafeInteger(check.timeoutMs) ||
      check.timeoutMs <= 0 ||
      check.timeoutMs > 60_000
    ) {
      throw new Error("Invalid check timeout");
    }
    if (
      check.requiredObservations?.some(
        (key) => !/^[a-z][a-z0-9-]{0,79}$/.test(key),
      )
    ) {
      throw new Error("Invalid check observation key");
    }
    const validModes = new Set<ScanMode>([
      "public_audit",
      "verified_monitoring",
      "verified_deep_audit",
    ]);
    if (
      check.modes.length === 0 ||
      check.modes.some((mode) => !validModes.has(mode)) ||
      (check.authorization === "deep" &&
        check.modes.some((mode) => mode !== "verified_deep_audit")) ||
      (check.authorization === "verified" &&
        check.modes.includes("public_audit")) ||
      (check.activity === "active_safe" &&
        (check.authorization === "public" ||
          check.modes.includes("public_audit")))
    ) {
      throw new Error("Invalid check authorization");
    }
    if (
      check.activity === "active_safe" &&
      (check.budget.activeSafeChecks ?? 0) < 1
    ) {
      throw new Error("Active-safe checks must reserve active-safe budget");
    }
    for (const amount of Object.values(check.budget)) {
      if (!Number.isSafeInteger(amount) || amount < 0)
        throw new Error("Invalid check budget");
    }
    this.checks.set(check.id, check);
  }

  get(id: string): CheckDefinition | undefined {
    return this.checks.get(id);
  }

  list(mode: ScanMode): readonly CheckDefinition[] {
    return [...this.checks.values()].filter((check) =>
      check.modes.includes(mode),
    );
  }

  listAll(): readonly CheckDefinition[] {
    return [...this.checks.values()];
  }
}
