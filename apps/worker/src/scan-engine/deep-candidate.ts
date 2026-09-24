import { scanCheckRuns, scans, sites } from "@agency-saas/db";
import { UnsafeTargetError, type DnsResolver } from "@agency-saas/security";
import { and, eq } from "drizzle-orm";
import type { Browser, LaunchOptions } from "playwright";
import { getDatabase } from "../database.js";
import type { HttpRequester } from "../http-probe.js";
import { BudgetLedger } from "./budget-ledger.js";
import {
  analyzeAndPersistDeepObservations,
  type DeepObservations,
} from "./deep-checks.js";
import {
  revalidateDeepAuditAuthorization,
  type TxtResolver,
} from "./deep-proof.js";
import { observeGuardedBrowserTarget } from "./guarded-browser-transport.js";
import {
  GuardedTransportError,
  probeGuardedHttpTarget,
} from "./guarded-http-transport.js";
import { resolveScanProfile } from "./profiles.js";
import { ScopeGuard } from "./scope-guard.js";
import {
  claimDeepLease,
  monitorDeepLease,
  releaseDeepLease,
  type DeepLease,
} from "./deep-lease.js";
import { throwIfAborted } from "./abort.js";
import type { CoverageReason, ScanProfile } from "./types.js";

const candidateChecks = new Set([
  "deep-http-observation",
  "deep-browser-observation",
]);

function checkedProfile(profile: ScanProfile): ScanProfile {
  const server = resolveScanProfile("verified_deep_audit");
  if (
    profile.mode !== "verified_deep_audit" ||
    new Set(profile.allowedChecks).size !== profile.allowedChecks.length ||
    profile.allowedChecks.some((id) => !candidateChecks.has(id)) ||
    Object.keys(server.budget).some(
      (key) =>
        !Number.isSafeInteger(
          profile.budget[key as keyof typeof server.budget],
        ) ||
        profile.budget[key as keyof typeof server.budget] < 0 ||
        profile.budget[key as keyof typeof server.budget] >
          server.budget[key as keyof typeof server.budget],
    ) ||
    !Number.isSafeInteger(profile.requestTimeoutMs) ||
    profile.requestTimeoutMs <= 0 ||
    profile.requestTimeoutMs > server.requestTimeoutMs ||
    !Number.isSafeInteger(profile.navigationTimeoutMs) ||
    profile.navigationTimeoutMs <= 0 ||
    profile.navigationTimeoutMs > server.navigationTimeoutMs ||
    !Number.isSafeInteger(profile.maxRedirects) ||
    profile.maxRedirects < 0 ||
    profile.maxRedirects > server.maxRedirects ||
    !Number.isSafeInteger(profile.concurrency) ||
    profile.concurrency <= 0 ||
    profile.concurrency > server.concurrency
  ) {
    throw new Error("Deep candidate profile exceeds server policy");
  }
  return profile;
}

function failureReason(error: unknown, ledger: BudgetLedger): CoverageReason {
  if (error instanceof GuardedTransportError) return error.code;
  if (error instanceof UnsafeTargetError) {
    return error.code === "dns" || error.code === "dns-empty"
      ? "dns-failed"
      : "ssrf-denied";
  }
  const recorded = ledger.snapshot().reasons;
  for (const reason of [
    "budget-bytes-transferred",
    "budget-time",
    "scope-denied",
    "budget-host-requests",
    "budget-http-requests",
  ] as const) {
    if (recorded.includes(reason)) return reason;
  }
  if (
    error instanceof Error &&
    (error.message.toLowerCase().includes("timeout") ||
      ("code" in error && error.code === "ETIMEDOUT"))
  ) {
    return "transport-timeout";
  }
  return "transport-failed";
}

/** Guarded Deep lifecycle. Only the internal worker gate may route queue jobs here. */
export async function runDeepAuditCandidate(input: {
  scanId: string;
  organizationId: string;
  siteId: string;
  targetUrl: string;
  /** Trusted internal override for isolated tests; checked against server caps. */
  profile?: ScanProfile;
  resolveTxt?: TxtResolver;
  resolver?: DnsResolver;
  requester?: HttpRequester;
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
  signal?: AbortSignal;
  onLeaseClaimed?: (lease: DeepLease) => void;
}): Promise<void> {
  const profile = checkedProfile(
    input.profile ?? resolveScanProfile("verified_deep_audit"),
  );
  throwIfAborted(input.signal);
  const lease = await claimDeepLease(input);
  const monitor = monitorDeepLease(lease, input.signal);
  try {
    input.onLeaseClaimed?.(lease);
    await monitor.assertCurrent();
    const { db } = getDatabase();
    const [scan] = await db
      .select({ status: scans.status, mode: scans.scanMode })
      .from(scans)
      .where(
        and(
          eq(scans.id, input.scanId),
          eq(scans.organizationId, input.organizationId),
          eq(scans.siteId, input.siteId),
        ),
      )
      .limit(1);
    if (
      !scan ||
      scan.status !== "running" ||
      scan.mode !== "verified_deep_audit"
    ) {
      throw new Error("Deep scan is not running for this site");
    }
    const prior = await db
      .select({ id: scanCheckRuns.id })
      .from(scanCheckRuns)
      .where(eq(scanCheckRuns.scanId, input.scanId))
      .limit(1);
    if (prior.length) throw new Error("Check runs already persisted");
    const [site] = await db
      .select({ canonicalUrl: sites.canonicalUrl })
      .from(sites)
      .where(
        and(
          eq(sites.id, input.siteId),
          eq(sites.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (
      !site ||
      new URL(input.targetUrl).toString() !==
        new URL(site.canonicalUrl).toString()
    ) {
      throw new Error("Deep scan target differs from the canonical site URL");
    }

    const scope = new ScopeGuard(site.canonicalUrl);
    const ledger = new BudgetLedger(profile.budget, Date.now());
    await monitor.assertCurrent();
    const authorization = await revalidateDeepAuditAuthorization({
      siteId: input.siteId,
      organizationId: input.organizationId,
      ...(input.resolveTxt ? { resolveTxt: input.resolveTxt } : {}),
      signal: monitor.signal,
    });
    if (authorization.allowed && !authorization.grantIdentity)
      throw new Error("Deep grant identity missing");
    if (authorization.allowed && authorization.grantIdentity) {
      if (authorization.grantIdentity.canonicalUrl !== site.canonicalUrl)
        throw new Error("Deep canonical URL changed during validation");
      monitor.setGrant(authorization.grantIdentity);
    }
    await monitor.assertCurrent();
    const observations: DeepObservations = {};
    const observationFailures: Record<string, string> = {};
    const needsHttp = profile.allowedChecks.includes("deep-http-observation");
    const needsBrowser = profile.allowedChecks.includes(
      "deep-browser-observation",
    );

    if (authorization.allowed && (needsHttp || needsBrowser)) {
      if (needsHttp) {
        try {
          observations.http = await probeGuardedHttpTarget({
            targetUrl: site.canonicalUrl,
            profile,
            authorization,
            scope,
            ledger,
            signal: monitor.signal,
            beforeNetwork: monitor.assertCurrent,
            transport: {
              ...(input.resolver ? { resolver: input.resolver } : {}),
              ...(input.requester ? { requester: input.requester } : {}),
            },
          });
        } catch (error) {
          throwIfAborted(monitor.signal);
          const reason = failureReason(error, ledger);
          ledger.markPartial(reason);
          observationFailures.http = reason;
          if (needsBrowser) observationFailures.browser = reason;
        }
      }
      if (
        needsBrowser &&
        (!needsHttp || observations.http) &&
        ledger.checkNetwork().allowed
      ) {
        try {
          observations.browser = await observeGuardedBrowserTarget({
            targetUrl: site.canonicalUrl,
            profile,
            authorization,
            scope,
            ledger,
            signal: monitor.signal,
            beforeNetwork: monitor.assertCurrent,
            ...(input.resolver ? { resolver: input.resolver } : {}),
            ...(input.launchBrowser
              ? { launchBrowser: input.launchBrowser }
              : {}),
          });
        } catch (error) {
          throwIfAborted(monitor.signal);
          const reason = failureReason(error, ledger);
          ledger.markPartial(reason);
          observationFailures.browser = reason;
        }
      } else if (
        needsBrowser &&
        !observationFailures.browser &&
        !observations.browser
      ) {
        observationFailures.browser = failureReason(
          new Error("Network budget unavailable"),
          ledger,
        );
      }
    }

    await analyzeAndPersistDeepObservations({
      scanId: input.scanId,
      organizationId: input.organizationId,
      siteId: input.siteId,
      targetUrl: site.canonicalUrl,
      profile,
      authorization,
      scope,
      ledger,
      observations,
      observationFailures,
      lease,
      signal: monitor.signal,
    });
  } finally {
    monitor.stop();
    await releaseDeepLease(lease);
  }
}
