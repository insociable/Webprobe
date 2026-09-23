export type ScanMode =
  | "public_audit"
  | "verified_deep_audit"
  | "verified_monitoring";

export type BudgetKind =
  | "httpRequests"
  | "pages"
  | "bytesTransferred"
  | "dnsQueries"
  | "tlsHandshakes"
  | "activeSafeChecks";

export type BudgetLimits = Readonly<Record<BudgetKind, number>> & {
  maxRequestsPerHostname: number;
  maxDurationMs: number;
};

export type ScanProfile = Readonly<{
  mode: ScanMode;
  budget: BudgetLimits;
  requestTimeoutMs: number;
  navigationTimeoutMs: number;
  maxRedirects: number;
  concurrency: number;
  allowedChecks: readonly string[];
  allowActiveSafe: boolean;
}>;

export type CoverageReason =
  | "budget-http-requests"
  | "budget-host-requests"
  | "budget-pages"
  | "budget-bytes-transferred"
  | "budget-dns-queries"
  | "budget-tls-handshakes"
  | "budget-active-safe-checks"
  | "budget-time"
  | "authorization-unavailable"
  | "scope-denied"
  | "ssrf-denied"
  | "check-timeout";
