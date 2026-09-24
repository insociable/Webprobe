import { describe, expect, it, vi } from "vitest";
import type { DnsResolver } from "@agency-saas/security";
import type { HttpRequester } from "../src/http-probe.js";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import {
  GuardedTransportError,
  probeGuardedHttpTarget,
} from "../src/scan-engine/guarded-http-transport.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

const profile = resolveScanProfile("verified_deep_audit");
const resolver: DnsResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

function fixture(
  requester: HttpRequester,
  overrides: Record<string, unknown> = {},
) {
  return {
    targetUrl: "https://example.com/",
    profile,
    authorization: { allowed: true as const, level: "deep" as const },
    scope: new ScopeGuard("https://example.com/"),
    ledger: new BudgetLedger(profile.budget, Date.now()),
    transport: { resolver, requester },
    signal: new AbortController().signal,
    beforeNetwork: async () => undefined,
    ...overrides,
  };
}

describe("guarded HTTP transport", () => {
  it("times out DNS within the remaining global scan budget", async () => {
    const requester = vi.fn<HttpRequester>(async () => {
      throw new Error("unexpected request");
    });
    const timedProfile = {
      ...profile,
      budget: { ...profile.budget, maxDurationMs: 30 },
    };
    const ledger = new BudgetLedger(timedProfile.budget, Date.now());
    const input = fixture(requester, {
      profile: timedProfile,
      ledger,
      transport: {
        resolver: async () => new Promise(() => undefined),
        requester,
      },
    });
    await expect(probeGuardedHttpTarget(input)).rejects.toMatchObject({
      code: "budget-time",
    });
    expect(requester).not.toHaveBeenCalled();
    expect(ledger.snapshot().reasons).toContain("budget-time");
  });
  it("rejects a requester that omits byte accounting", async () => {
    const requester = vi.fn<HttpRequester>(async () => ({
      statusCode: 200,
      durationMs: 1,
      tls: null,
      headers: {},
    }));
    const input = fixture(requester);
    await expect(probeGuardedHttpTarget(input)).rejects.toThrow(
      "omitted transfer accounting",
    );
  });

  it("stops a response that exceeds the shared byte budget", async () => {
    const requester = vi.fn<HttpRequester>(
      async (_target, _timeout, account) => {
        account?.(129);
        return { statusCode: 200, durationMs: 1, tls: null, headers: {} };
      },
    );
    const limitedProfile = {
      ...profile,
      budget: { ...profile.budget, bytesTransferred: 128 },
    };
    const input = fixture(requester, {
      profile: limitedProfile,
      ledger: new BudgetLedger(limitedProfile.budget, Date.now()),
    });
    await expect(probeGuardedHttpTarget(input)).rejects.toMatchObject({
      code: "budget-bytes-transferred",
    });
    expect(input.ledger.snapshot().reasons).toContain(
      "budget-bytes-transferred",
    );
    await expect(probeGuardedHttpTarget(input)).rejects.toMatchObject({
      code: "budget-bytes-transferred",
    });
    expect(requester).toHaveBeenCalledOnce();
  });
  it("rejects missing authorization before DNS or transport", async () => {
    const dns = vi.fn(resolver);
    const requester = vi.fn<HttpRequester>(async () => {
      throw new Error("unexpected request");
    });
    const input = fixture(requester, {
      authorization: { allowed: false, reason: "deep-grant-missing" },
      transport: { resolver: dns, requester },
    });
    await expect(probeGuardedHttpTarget(input)).rejects.toMatchObject({
      code: "authorization-unavailable",
    });
    expect(dns).not.toHaveBeenCalled();
    expect(requester).not.toHaveBeenCalled();
    expect(input.ledger.snapshot().reasons).toContain(
      "authorization-unavailable",
    );
  });

  it("rejects an out-of-scope target before DNS or transport", async () => {
    const dns = vi.fn(resolver);
    const requester = vi.fn<HttpRequester>(async () => {
      throw new Error("unexpected request");
    });
    const input = fixture(requester, {
      targetUrl: "https://sub.example.com/",
      transport: { resolver: dns, requester },
    });
    await expect(probeGuardedHttpTarget(input)).rejects.toBeInstanceOf(
      GuardedTransportError,
    );
    expect(dns).not.toHaveBeenCalled();
    expect(requester).not.toHaveBeenCalled();
    expect(input.ledger.snapshot().reasons).toContain("scope-denied");
  });

  it("stops an out-of-scope redirect without resolving or requesting the destination", async () => {
    const dns = vi.fn(resolver);
    const requester = vi.fn<HttpRequester>(
      async (_target, _timeout, account) => {
        account?.(128);
        return {
          statusCode: 302,
          durationMs: 1,
          tls: null,
          headers: { location: "https://other.example.test/private" },
        };
      },
    );
    const input = fixture(requester, {
      transport: { resolver: dns, requester },
    });
    const result = await probeGuardedHttpTarget(input);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "REDIRECT_NOT_ALLOWED" },
    });
    expect(dns).toHaveBeenCalledOnce();
    expect(requester).toHaveBeenCalledOnce();
    expect(input.ledger.snapshot()).toMatchObject({
      partial: true,
      reasons: ["scope-denied"],
    });
  });

  it("reserves request, DNS and TLS budgets before each permitted hop", async () => {
    const requester = vi.fn<HttpRequester>(
      async (target, _timeout, account) => {
        account?.(128);
        return {
          statusCode: target.url.pathname === "/" ? 302 : 200,
          durationMs: 1,
          tls: null,
          headers: target.url.pathname === "/" ? { location: "/next" } : {},
        };
      },
    );
    const input = fixture(requester);
    const result = await probeGuardedHttpTarget(input);
    expect(result.ok).toBe(true);
    expect(requester).toHaveBeenCalledTimes(2);
    expect(input.ledger.snapshot().used).toMatchObject({
      httpRequests: 2,
      dnsQueries: 2,
      tlsHandshakes: 2,
      bytesTransferred: 256,
    });
  });

  it("fails before DNS when the shared request budget is exhausted", async () => {
    const dns = vi.fn(resolver);
    const requester = vi.fn<HttpRequester>(async () => {
      throw new Error("unexpected request");
    });
    const limitedProfile = {
      ...profile,
      budget: { ...profile.budget, httpRequests: 0 },
    };
    const input = fixture(requester, {
      profile: limitedProfile,
      ledger: new BudgetLedger(limitedProfile.budget, Date.now()),
      transport: { resolver: dns, requester },
    });
    await expect(probeGuardedHttpTarget(input)).rejects.toMatchObject({
      code: "budget-http-requests",
    });
    expect(dns).not.toHaveBeenCalled();
    expect(requester).not.toHaveBeenCalled();
  });

  it("retains SSRF blocking after the scope and budget guards", async () => {
    const privateResolver: DnsResolver = async () => [
      { address: "127.0.0.1", family: 4 },
    ];
    const requester = vi.fn<HttpRequester>(async () => {
      throw new Error("unexpected request");
    });
    const input = fixture(requester, {
      transport: { resolver: privateResolver, requester },
    });
    await expect(probeGuardedHttpTarget(input)).rejects.toMatchObject({
      name: "UnsafeTargetError",
    });
    expect(requester).not.toHaveBeenCalled();
    expect(input.ledger.snapshot().reasons).toContain("ssrf-denied");
  });
});
