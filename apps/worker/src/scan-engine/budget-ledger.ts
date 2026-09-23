import type { BudgetKind, BudgetLimits, CoverageReason } from "./types.js";

const reasonByKind: Record<BudgetKind, CoverageReason> = {
  httpRequests: "budget-http-requests",
  pages: "budget-pages",
  bytesTransferred: "budget-bytes-transferred",
  dnsQueries: "budget-dns-queries",
  tlsHandshakes: "budget-tls-handshakes",
  activeSafeChecks: "budget-active-safe-checks",
};
const budgetKinds = Object.keys(reasonByKind) as BudgetKind[];

export type BudgetReservation =
  | { allowed: true }
  | { allowed: false; reason: CoverageReason };

export class BudgetLedger {
  private readonly used: Record<BudgetKind, number> = {
    httpRequests: 0,
    pages: 0,
    bytesTransferred: 0,
    dnsQueries: 0,
    tlsHandshakes: 0,
    activeSafeChecks: 0,
  };
  private readonly requestsByHostname = new Map<string, number>();
  private readonly reasons = new Set<CoverageReason>();

  constructor(
    private readonly limits: BudgetLimits,
    private readonly startedAtMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
      throw new Error("Invalid budget start time");
    }
    for (const value of Object.values(limits)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error("Budget limits must be nonnegative safe integers");
      }
    }
  }

  reserve(kind: BudgetKind, amount = 1, hostname?: string): BudgetReservation {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Budget reservation must be a positive safe integer");
    }
    return this.reserveMany({ [kind]: amount }, hostname);
  }

  /** Reserves a check's complete cost atomically, before any work begins. */
  reserveMany(
    costs: Partial<Record<BudgetKind, number>>,
    hostname?: string,
  ): BudgetReservation {
    for (const [kind, amount] of Object.entries(costs)) {
      if (
        !budgetKinds.includes(kind as BudgetKind) ||
        !Number.isSafeInteger(amount) ||
        amount < 0
      ) {
        throw new Error("Invalid budget reservation");
      }
    }
    if (this.timeExceeded()) return this.deny("budget-time");
    const requestAmount = costs.httpRequests ?? 0;
    let normalizedHost: string | undefined;
    if (requestAmount > 0) {
      if (!hostname || !/^[a-z0-9.-]+$/i.test(hostname)) {
        return this.deny("scope-denied");
      }
      normalizedHost = hostname.toLowerCase().replace(/\.$/, "");
      if (
        (this.requestsByHostname.get(normalizedHost) ?? 0) + requestAmount >
        this.limits.maxRequestsPerHostname
      ) {
        return this.deny("budget-host-requests");
      }
    }
    for (const kind of budgetKinds) {
      if (this.used[kind] + (costs[kind] ?? 0) > this.limits[kind]) {
        return this.deny(reasonByKind[kind]);
      }
    }
    for (const kind of budgetKinds) this.used[kind] += costs[kind] ?? 0;
    if (normalizedHost) {
      this.requestsByHostname.set(
        normalizedHost,
        (this.requestsByHostname.get(normalizedHost) ?? 0) + requestAmount,
      );
    }
    return { allowed: true };
  }

  checkTime(): BudgetReservation {
    return this.timeExceeded() ? this.deny("budget-time") : { allowed: true };
  }

  markPartial(reason: CoverageReason): void {
    this.reasons.add(reason);
  }

  snapshot() {
    return {
      used: { ...this.used },
      requestsByHostname: Object.fromEntries(this.requestsByHostname),
      partial: this.reasons.size > 0,
      reasons: [...this.reasons],
      elapsedMs: Math.max(0, this.now() - this.startedAtMs),
    };
  }

  private deny(reason: CoverageReason): BudgetReservation {
    this.reasons.add(reason);
    return { allowed: false, reason };
  }

  private timeExceeded(): boolean {
    const current = this.now();
    return (
      !Number.isSafeInteger(current) ||
      current < this.startedAtMs ||
      current - this.startedAtMs >= this.limits.maxDurationMs
    );
  }
}
