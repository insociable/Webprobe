import type { AuthorizationDecision } from "./authorization.js";
import { UnsafeTargetError, defaultDnsResolver } from "@agency-saas/security";
import { BudgetLedger } from "./budget-ledger.js";
import { ScopeGuard } from "./scope-guard.js";
import type { CoverageReason, ScanProfile } from "./types.js";
import {
  probeHttpTarget,
  type HttpProbeOptions,
  type HttpProbeResult,
} from "../http-probe.js";

export class GuardedTransportError extends Error {
  constructor(readonly code: CoverageReason) {
    super(code);
    this.name = "GuardedTransportError";
  }
}

export async function probeGuardedHttpTarget(input: {
  targetUrl: string;
  profile: ScanProfile;
  authorization: AuthorizationDecision;
  scope: ScopeGuard;
  ledger: BudgetLedger;
  transport?: Pick<HttpProbeOptions, "resolver" | "requester">;
}): Promise<HttpProbeResult> {
  const { authorization, ledger, profile, scope } = input;
  if (
    !authorization.allowed ||
    (profile.mode === "verified_deep_audit" &&
      authorization.level !== "deep") ||
    (profile.mode === "verified_monitoring" && authorization.level === "public")
  ) {
    ledger.markPartial("authorization-unavailable");
    throw new GuardedTransportError("authorization-unavailable");
  }

  try {
    const resolver = input.transport?.resolver ?? defaultDnsResolver;
    return await probeHttpTarget(input.targetUrl, {
      ...input.transport,
      resolver: async (hostname) => {
        const remaining = Math.min(
          profile.requestTimeoutMs,
          ledger.remainingDurationMs(),
        );
        if (remaining <= 0) {
          ledger.markPartial("budget-time");
          throw new GuardedTransportError("budget-time");
        }
        let timer: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            resolver(hostname),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                ledger.markPartial("budget-time");
                reject(new GuardedTransportError("budget-time"));
              }, remaining);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
      timeoutMs: profile.requestTimeoutMs,
      maxRedirects: profile.maxRedirects,
      beforeConnect(target) {
        const network = ledger.checkNetwork();
        if (!network.allowed) throw new GuardedTransportError(network.reason);
        if (!scope.allows(target.url.toString()).allowed) {
          ledger.markPartial("scope-denied");
          throw new GuardedTransportError("scope-denied");
        }
        return Math.max(
          1,
          Math.min(profile.requestTimeoutMs, ledger.remainingDurationMs()),
        );
      },
      requireTransferAccounting: true,
      accountTransferredBytes(bytes) {
        if (!Number.isSafeInteger(bytes) || bytes < 0) {
          ledger.markPartial("budget-bytes-transferred");
          throw new GuardedTransportError("budget-bytes-transferred");
        }
        if (bytes === 0) return;
        const reservation = ledger.reserve("bytesTransferred", bytes);
        if (!reservation.allowed)
          throw new GuardedTransportError(reservation.reason);
      },
      beforeRequest(url) {
        const network = ledger.checkNetwork();
        if (!network.allowed) throw new GuardedTransportError(network.reason);
        if (!scope.allows(url.toString()).allowed) {
          ledger.markPartial("scope-denied");
          throw new GuardedTransportError("scope-denied");
        }
        const reservation = ledger.reserveMany(
          {
            httpRequests: 1,
            dnsQueries: 1,
            tlsHandshakes: url.protocol === "https:" ? 1 : 0,
          },
          url.hostname,
        );
        if (!reservation.allowed)
          throw new GuardedTransportError(reservation.reason);
      },
      allowRedirect(from, to) {
        const decision = scope.allowsRedirect(from.toString(), to.toString());
        if (!decision.allowed) ledger.markPartial("scope-denied");
        return decision.allowed;
      },
    });
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      if (ledger.snapshot().reasons.includes("budget-time")) {
        throw new GuardedTransportError("budget-time");
      }
      ledger.markPartial(
        error.code === "dns" || error.code === "dns-empty"
          ? "dns-failed"
          : "ssrf-denied",
      );
    }
    throw error;
  }
}
