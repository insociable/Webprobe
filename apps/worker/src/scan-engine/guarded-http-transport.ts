import type { AuthorizationDecision } from "./authorization.js";
import { UnsafeTargetError, defaultDnsResolver } from "@agency-saas/security";
import { BudgetLedger } from "./budget-ledger.js";
import { ScopeGuard } from "./scope-guard.js";
import type { CoverageReason, ScanProfile } from "./types.js";
import { abortable, cancellableDnsResolver, throwIfAborted } from "./abort.js";
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
  signal?: AbortSignal;
  beforeNetwork?: () => Promise<void>;
}): Promise<HttpProbeResult> {
  throwIfAborted(input.signal);
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
  if (
    profile.mode === "verified_deep_audit" &&
    (!input.signal || !input.beforeNetwork)
  ) {
    throw new GuardedTransportError("authorization-unavailable");
  }

  try {
    const resolver =
      input.transport?.resolver ??
      (input.signal
        ? cancellableDnsResolver(input.signal)
        : defaultDnsResolver);
    return await abortable(
      probeHttpTarget(input.targetUrl, {
        ...input.transport,
        ...(input.signal ? { signal: input.signal } : {}),
        resolver: async (hostname) => {
          throwIfAborted(input.signal);
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
            return await abortable(
              Promise.race([
                resolver(hostname),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => {
                    ledger.markPartial("budget-time");
                    reject(new GuardedTransportError("budget-time"));
                  }, remaining);
                }),
              ]),
              input.signal,
            );
          } finally {
            if (timer) clearTimeout(timer);
          }
        },
        timeoutMs: profile.requestTimeoutMs,
        maxRedirects: profile.maxRedirects,
        async beforeConnect(target) {
          throwIfAborted(input.signal);
          await input.beforeNetwork?.();
          throwIfAborted(input.signal);
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
          throwIfAborted(input.signal);
          if (!Number.isSafeInteger(bytes) || bytes < 0) {
            ledger.markPartial("budget-bytes-transferred");
            throw new GuardedTransportError("budget-bytes-transferred");
          }
          if (bytes === 0) return;
          const reservation = ledger.reserve("bytesTransferred", bytes);
          if (!reservation.allowed)
            throw new GuardedTransportError(reservation.reason);
        },
        async beforeRequest(url) {
          throwIfAborted(input.signal);
          await input.beforeNetwork?.();
          throwIfAborted(input.signal);
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
      }),
      input.signal,
    );
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
