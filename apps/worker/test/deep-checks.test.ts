import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { createDeepCheckRegistry } from "../src/scan-engine/deep-checks.js";
import { runChecks } from "../src/scan-engine/engine.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

describe("deep check registry", () => {
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
    expect(runs).toHaveLength(2);
    expect(
      runs.every(
        (run) =>
          run.status === "skipped" && run.skipReason === "profile-denied",
      ),
    ).toBe(true);
    expect(runs.every((run) => run.evidence.length === 0)).toBe(true);
  });
});
