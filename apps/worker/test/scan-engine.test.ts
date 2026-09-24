import { describe, expect, it, vi } from "vitest";
import { authorizeScan } from "../src/scan-engine/authorization.js";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { CheckRegistry } from "../src/scan-engine/check-registry.js";
import { runChecks } from "../src/scan-engine/engine.js";
import { createEvidence } from "../src/scan-engine/evidence.js";
import {
  resolveLegacyBrowserOptions,
  resolveScanProfile,
} from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

describe("server-resolved scan profiles", () => {
  it("keeps the V2 public and monitoring caps while separating deep audit", () => {
    expect(resolveScanProfile("public_audit").budget.pages).toBe(15);
    expect(resolveScanProfile("public_audit").budget.httpRequests).toBe(200);
    expect(resolveScanProfile("verified_monitoring").navigationTimeoutMs).toBe(
      60_000,
    );
    expect(resolveScanProfile("verified_monitoring").allowActiveSafe).toBe(
      false,
    );
    expect(resolveScanProfile("verified_deep_audit").budget.pages).toBe(40);
    expect(resolveScanProfile("verified_deep_audit").allowActiveSafe).toBe(
      true,
    );
    expect(resolveScanProfile("verified_deep_audit").allowedChecks).toEqual([]);
    expect(
      Object.isFrozen(resolveScanProfile("verified_deep_audit").budget),
    ).toBe(true);
  });

  it("never lets a queued V2 profile raise server limits", () => {
    const requested = {
      maxPages: 100,
      navigationTimeoutMs: 60_000,
      checkAccessibility: true,
      captureScreenshots: false,
    };
    expect(
      resolveLegacyBrowserOptions("public_audit", requested),
    ).toMatchObject({
      maxPages: 15,
      navigationTimeoutMs: 20_000,
    });
    expect(
      resolveLegacyBrowserOptions("verified_monitoring", requested),
    ).toMatchObject({
      maxPages: 20,
      navigationTimeoutMs: 60_000,
    });
    expect(
      resolveLegacyBrowserOptions("public_audit", { ...requested, maxPages: 3 })
        .maxPages,
    ).toBe(3);
  });
});

describe("BudgetLedger", () => {
  it("bounds requests globally and by hostname with explicit partial coverage", () => {
    const limits = {
      ...resolveScanProfile("public_audit").budget,
      httpRequests: 3,
      maxRequestsPerHostname: 2,
    };
    const ledger = new BudgetLedger(limits, 1_000, () => 1_010);
    expect(ledger.reserve("httpRequests", 2, "example.com")).toEqual({
      allowed: true,
    });
    expect(ledger.reserve("httpRequests", 1, "example.com")).toEqual({
      allowed: false,
      reason: "budget-host-requests",
    });
    expect(ledger.reserve("httpRequests", 1, "other.example")).toEqual({
      allowed: true,
    });
    expect(ledger.reserve("httpRequests", 1, "third.example")).toEqual({
      allowed: false,
      reason: "budget-http-requests",
    });
    expect(ledger.snapshot()).toMatchObject({
      partial: true,
      reasons: ["budget-host-requests", "budget-http-requests"],
      used: { httpRequests: 3 },
    });
  });

  it("bounds pages, bytes, active checks and elapsed time", () => {
    let now = 1_000;
    const ledger = new BudgetLedger(
      {
        ...resolveScanProfile("verified_deep_audit").budget,
        pages: 1,
        bytesTransferred: 8,
        activeSafeChecks: 1,
        maxDurationMs: 10,
      },
      now,
      () => now,
    );
    expect(ledger.reserve("pages")).toEqual({ allowed: true });
    expect(ledger.reserve("pages")).toMatchObject({ reason: "budget-pages" });
    expect(ledger.reserve("bytesTransferred", 9)).toMatchObject({
      reason: "budget-bytes-transferred",
    });
    expect(ledger.reserve("activeSafeChecks")).toEqual({ allowed: true });
    expect(ledger.reserve("activeSafeChecks")).toMatchObject({
      reason: "budget-active-safe-checks",
    });
    now += 10;
    expect(ledger.reserve("dnsQueries")).toMatchObject({
      reason: "budget-time",
    });
    expect(ledger.snapshot().used.dnsQueries).toBe(0);
  });

  it("fails closed for missing host, invalid amounts and a regressed clock", () => {
    let now = 1_000;
    const ledger = new BudgetLedger(
      resolveScanProfile("public_audit").budget,
      now,
      () => now,
    );
    expect(ledger.reserve("httpRequests")).toMatchObject({
      reason: "scope-denied",
    });
    expect(() => ledger.reserve("pages", -1)).toThrow();
    now = 999;
    expect(ledger.checkTime()).toMatchObject({ reason: "budget-time" });
  });

  it("does not charge one resource when a multi-resource reservation fails", () => {
    const ledger = new BudgetLedger(
      { ...resolveScanProfile("public_audit").budget, pages: 0 },
      1_000,
      () => 1_001,
    );
    expect(
      ledger.reserveMany({ httpRequests: 1, pages: 1 }, "example.com"),
    ).toMatchObject({
      reason: "budget-pages",
    });
    expect(ledger.snapshot().used).toMatchObject({ httpRequests: 0, pages: 0 });
  });
});

describe("scope and authorization", () => {
  it("does not infer subdomain, sibling port, redirect or CNAME scope", () => {
    const scope = new ScopeGuard("https://example.com/");
    expect(scope.allows("https://example.com/path")).toEqual({ allowed: true });
    for (const url of [
      "https://a.example.com/",
      "https://example.com:8443/",
      "http://example.com/",
      "https://cdn.example.net/",
    ]) {
      expect(scope.allows(url)).toMatchObject({
        allowed: false,
        reason: "outside-scope",
      });
      expect(scope.allowsRedirect("https://example.com/", url).allowed).toBe(
        false,
      );
    }
    expect(scope.allows("ftp://example.com/")).toMatchObject({
      reason: "invalid-url",
    });
  });

  it("retains V2 verification semantics and requires a current deep grant", () => {
    const now = new Date("2026-09-23T12:00:00.000Z");
    const base = {
      siteId: "site-1",
      siteStatus: "active" as const,
      verifiedAt: new Date("2026-09-01T00:00:00.000Z"),
      now,
    };
    expect(authorizeScan({ ...base, mode: "verified_monitoring" })).toEqual({
      allowed: true,
      level: "verified",
    });
    expect(
      authorizeScan({ ...base, mode: "verified_deep_audit" }),
    ).toMatchObject({ reason: "deep-grant-missing" });
    const deepGrant = {
      siteId: "site-1",
      proofType: "dns_txt" as const,
      proofRecordName: "_agency-monitor.example.com",
      proofTokenHash: "a".repeat(64),
      proofVerifiedAt: new Date("2026-09-22T00:00:00.000Z"),
      revalidatedAt: new Date("2026-09-23T11:59:00.000Z"),
      expiresAt: new Date("2026-09-24T00:00:00.000Z"),
      revokedAt: null,
    };
    expect(
      authorizeScan({ ...base, mode: "verified_deep_audit", deepGrant }),
    ).toEqual({ allowed: true, level: "deep" });
    expect(
      authorizeScan({
        ...base,
        mode: "verified_deep_audit",
        deepGrant: { ...deepGrant, revokedAt: now },
      }),
    ).toMatchObject({ reason: "deep-grant-revoked" });
    expect(
      authorizeScan({
        ...base,
        mode: "verified_deep_audit",
        deepGrant: { ...deepGrant, expiresAt: now },
      }),
    ).toMatchObject({ reason: "deep-grant-expired" });
    expect(
      authorizeScan({
        ...base,
        mode: "verified_deep_audit",
        deepGrant: { ...deepGrant, revalidatedAt: null },
      }),
    ).toMatchObject({ reason: "deep-grant-invalid" });
    expect(
      authorizeScan({
        ...base,
        mode: "verified_deep_audit",
        deepGrant: {
          ...deepGrant,
          revalidatedAt: new Date("2026-09-23T11:54:59.000Z"),
        },
      }),
    ).toMatchObject({ reason: "deep-grant-invalid" });
  });
});

describe("check registry and evidence", () => {
  it("validates identity and evidence classification", () => {
    const evidence = createEvidence({
      checkId: "tls-observation",
      checkVersion: "1.0.0",
      classification: "observation",
      confidence: 0.8,
      data: { protocol: "TLSv1.3" },
    });
    expect(evidence.classification).toBe("observation");
    expect(() => createEvidence({ ...evidence, confidence: 1.1 })).toThrow();
    expect(() =>
      createEvidence({ ...evidence, classification: "unknown" as never }),
    ).toThrow();
  });

  it("runs an authorized passive check over collected data and rejects duplicates", async () => {
    const registry = new CheckRegistry();
    const check = {
      id: "tls-observation",
      version: "1.0.0",
      category: "tls",
      authorization: "deep" as const,
      activity: "passive" as const,
      modes: ["verified_deep_audit" as const],
      budget: { pages: 1 },
      timeoutMs: 1_000,
      analyze: vi.fn(
        async (observations: Readonly<Record<string, unknown>>) => [
          createEvidence({
            checkId: "tls-observation",
            checkVersion: "1.0.0",
            classification: "observation",
            confidence: 1,
            data: { protocol: observations.protocol },
          }),
        ],
      ),
      remediation: null,
    };
    registry.register(check);
    expect(() => registry.register(check)).toThrow("Duplicate check ID");
    expect(() =>
      new CheckRegistry().register({
        ...check,
        modes: ["public_audit"],
      }),
    ).toThrow("Invalid check authorization");
    expect(() =>
      new CheckRegistry().register({
        ...check,
        activity: "active_safe",
        budget: { activeSafeChecks: 0 },
      }),
    ).toThrow("Active-safe checks must reserve active-safe budget");
    const profile = {
      ...resolveScanProfile("verified_deep_audit"),
      allowedChecks: [check.id],
    };
    const ledger = new BudgetLedger(profile.budget, Date.now());
    const runs = await runChecks({
      profile,
      registry,
      ledger,
      scope: new ScopeGuard("https://example.com/"),
      authorization: { allowed: true, level: "deep" },
      targetUrl: "https://example.com/",
      observations: { protocol: "TLSv1.3" },
    });
    expect(runs).toMatchObject([
      { status: "completed", evidence: [{ classification: "observation" }] },
    ]);
    expect(check.analyze).toHaveBeenCalledOnce();
    await expect(
      runChecks({
        profile,
        registry,
        ledger,
        scope: new ScopeGuard("https://example.com/"),
        authorization: { allowed: false, reason: "deep-grant-missing" },
        targetUrl: "https://example.com/",
        observations: {},
      }),
    ).resolves.toMatchObject([
      {
        status: "skipped",
        skipReason: "authorization-unavailable",
        evidence: [],
      },
    ]);
  });
});
