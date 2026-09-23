import type { AuthorizationDecision } from "./authorization.js";
import { UnsafeTargetError } from "@agency-saas/security";
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
    return await probeHttpTarget(input.targetUrl, {
      ...input.transport,
      timeoutMs: profile.requestTimeoutMs,
      maxRedirects: profile.maxRedirects,
      beforeRequest(url) {
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
    if (error instanceof UnsafeTargetError) ledger.markPartial("ssrf-denied");
    throw error;
  }
}
