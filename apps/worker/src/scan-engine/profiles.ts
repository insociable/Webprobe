import type { ScanMode, ScanProfile } from "./types.js";

const profiles: Record<ScanMode, ScanProfile> = {
  public_audit: {
    mode: "public_audit",
    budget: {
      httpRequests: 200,
      pages: 15,
      bytesTransferred: 20_000_000,
      dnsQueries: 200,
      tlsHandshakes: 200,
      activeSafeChecks: 0,
      maxRequestsPerHostname: 80,
      maxDurationMs: 120_000,
    },
    requestTimeoutMs: 10_000,
    navigationTimeoutMs: 20_000,
    maxRedirects: 5,
    concurrency: 1,
    allowedChecks: ["v2-http", "v2-browser"],
    allowActiveSafe: false,
  },
  verified_monitoring: {
    mode: "verified_monitoring",
    budget: {
      httpRequests: 1_000,
      pages: 20,
      bytesTransferred: 50_000_000,
      dnsQueries: 1_000,
      tlsHandshakes: 1_000,
      activeSafeChecks: 0,
      maxRequestsPerHostname: 1_000,
      maxDurationMs: 180_000,
    },
    requestTimeoutMs: 10_000,
    navigationTimeoutMs: 60_000,
    maxRedirects: 5,
    concurrency: 1,
    allowedChecks: ["v2-http", "v2-browser"],
    allowActiveSafe: false,
  },
  verified_deep_audit: {
    mode: "verified_deep_audit",
    budget: {
      httpRequests: 600,
      pages: 40,
      bytesTransferred: 100_000_000,
      dnsQueries: 600,
      tlsHandshakes: 600,
      activeSafeChecks: 10,
      maxRequestsPerHostname: 300,
      maxDurationMs: 300_000,
    },
    requestTimeoutMs: 15_000,
    navigationTimeoutMs: 30_000,
    maxRedirects: 5,
    concurrency: 2,
    allowedChecks: [],
    allowActiveSafe: true,
  },
};

export function resolveScanProfile(mode: ScanMode): ScanProfile {
  const profile = profiles[mode];
  if (!profile) throw new Error("Unknown scan mode");
  return profile;
}

export function resolveLegacyBrowserOptions(
  mode: "public_audit" | "verified_monitoring",
  requested: {
    maxPages: number;
    navigationTimeoutMs: number;
    checkAccessibility: boolean;
    captureScreenshots: boolean;
  },
) {
  const profile = resolveScanProfile(mode);
  return {
    scanMode: mode,
    maxPages: Math.min(requested.maxPages, profile.budget.pages),
    navigationTimeoutMs: Math.min(
      requested.navigationTimeoutMs,
      profile.navigationTimeoutMs,
    ),
    checkAccessibility: requested.checkAccessibility,
    captureScreenshot: requested.captureScreenshots,
  } as const;
}
