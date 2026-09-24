import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { CheckRegistry } from "../src/scan-engine/check-registry.js";
import { createDeepCheckRegistry } from "../src/scan-engine/deep-checks.js";
import { runChecks } from "../src/scan-engine/engine.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

describe("deep check registry", () => {
  it("keeps completed HTTP evidence when browser collection stops on bytes", async () => {
    const profile = {
      ...resolveScanProfile("verified_deep_audit"),
      allowedChecks: ["deep-http-observation", "deep-browser-observation"],
    };
    const ledger = new BudgetLedger(profile.budget, Date.now());
    ledger.markPartial("budget-bytes-transferred");
    const runs = await runChecks({
      profile,
      registry: createDeepCheckRegistry(),
      ledger,
      scope: new ScopeGuard("https://example.com/"),
      authorization: { allowed: true, level: "deep" },
      targetUrl: "https://example.com/",
      observations: {
        http: {
          ok: true,
          finalUrl: "https://example.com/",
          statusCode: 200,
          durationMs: 1,
          redirects: [],
          headers: {},
          securityHeaders: [],
          tls: null,
        },
      },
      observationFailures: { browser: "budget-bytes-transferred" },
    });
    expect(runs.slice(0, 2)).toMatchObject([
      { status: "completed", evidence: [{ classification: "observation" }] },
      {
        status: "skipped",
        skipReason: "budget-bytes-transferred",
        evidence: [],
      },
    ]);
  });
  it("distinguishes non-applicable, out-of-scope and interrupted checks", async () => {
    const registry = createDeepCheckRegistry();
    const publicProfile = resolveScanProfile("public_audit");
    const publicRuns = await runChecks({
      profile: publicProfile,
      registry,
      ledger: new BudgetLedger(publicProfile.budget, Date.now()),
      scope: new ScopeGuard("https://example.com/"),
      authorization: { allowed: true, level: "public" },
      targetUrl: "https://example.com/",
      observations: {},
    });
    expect(publicRuns.every((run) => run.skipReason === "not-applicable")).toBe(
      true,
    );
    const deepProfile = resolveScanProfile("verified_deep_audit");
    const common = {
      profile: deepProfile,
      registry,
      ledger: new BudgetLedger(deepProfile.budget, Date.now()),
      scope: new ScopeGuard("https://example.com/"),
      authorization: { allowed: true as const, level: "deep" as const },
      observations: {},
    };
    const denied = await runChecks({
      ...common,
      targetUrl: "https://other.example/",
    });
    expect(denied.every((run) => run.skipReason === "scope-denied")).toBe(true);
    const controller = new AbortController();
    controller.abort();
    const interrupted = await runChecks({
      ...common,
      targetUrl: "https://example.com/",
      signal: controller.signal,
    });
    expect(
      interrupted.every((run) => run.skipReason === "scan-interrupted"),
    ).toBe(true);
  });
  it("keeps built-in checks skipped under the locked production profile", async () => {
    const profile = resolveScanProfile("verified_deep_audit");
    const ledger = new BudgetLedger(profile.budget, Date.now());
    const runs = await runChecks({
      profile,
      registry: createDeepCheckRegistry(),
      ledger,
      scope: new ScopeGuard("https://example.com/"),
      authorization: { allowed: true, level: "deep" },
      targetUrl: "https://example.com/",
      observations: {},
    });
    expect(runs).toHaveLength(10);
    expect(
      runs.every(
        (run) =>
          run.status === "skipped" && run.skipReason === "profile-denied",
      ),
    ).toBe(true);
    expect(runs.every((run) => run.evidence.length === 0)).toBe(true);
  });
  it("aborts an analysis already in progress", async () => {
    const controller = new AbortController();
    const registry = new CheckRegistry();
    let entered!: () => void;
    let analysisSignal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    registry.register({
      id: "deep-slow-analysis",
      version: "1.0.0",
      category: "test",
      authorization: "deep",
      activity: "passive",
      modes: ["verified_deep_audit"],
      budget: {},
      timeoutMs: 10_000,
      remediation: null,
      async analyze(_observations, signal) {
        analysisSignal = signal;
        entered();
        return new Promise<never>(() => undefined);
      },
    });
    const profile = {
      ...resolveScanProfile("verified_deep_audit"),
      allowedChecks: ["deep-slow-analysis"],
    };
    const running = runChecks({
      profile,
      registry,
      ledger: new BudgetLedger(profile.budget, Date.now()),
      scope: new ScopeGuard("https://example.com/"),
      authorization: { allowed: true, level: "deep" },
      targetUrl: "https://example.com/",
      observations: {},
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await expect(running).rejects.toThrow("aborted");
    expect(analysisSignal?.aborted).toBe(true);
  });
});
