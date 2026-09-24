import type { BrowserRuntimeObservation } from "../browser-runtime.js";
import type { HttpProbeResult } from "../http-probe.js";
import type { AuthorizationDecision } from "./authorization.js";
import { BudgetLedger } from "./budget-ledger.js";
import { CheckRegistry } from "./check-registry.js";
import { persistDeepCheckRuns } from "./check-persistence.js";
import { runChecks, type CheckRun } from "./engine.js";
import { createEvidence } from "./evidence.js";
import { ScopeGuard } from "./scope-guard.js";
import type { ScanProfile } from "./types.js";

export type DeepObservations = Readonly<{
  http: HttpProbeResult;
  browser: BrowserRuntimeObservation;
}>;

/** Passive checks consume observations only; neither check can initiate network I/O. */
export function createDeepCheckRegistry(): CheckRegistry {
  const registry = new CheckRegistry();
  registry.register({
    id: "deep-http-observation",
    version: "1.0.0",
    category: "http",
    authorization: "deep",
    activity: "passive",
    modes: ["verified_deep_audit"],
    budget: {},
    timeoutMs: 1_000,
    remediation: null,
    async analyze(input) {
      const http = input.http as HttpProbeResult | undefined;
      if (!http || typeof http.ok !== "boolean")
        throw new Error("Missing HTTP observation");
      return [
        createEvidence({
          checkId: "deep-http-observation",
          checkVersion: "1.0.0",
          classification: "observation",
          confidence: 1,
          data: http.ok
            ? { statusCode: http.statusCode, redirects: http.redirects.length }
            : { errorKind: http.error.kind, redirects: http.redirects.length },
        }),
      ];
    },
  });
  registry.register({
    id: "deep-browser-observation",
    version: "1.0.0",
    category: "browser",
    authorization: "deep",
    activity: "passive",
    modes: ["verified_deep_audit"],
    budget: {},
    timeoutMs: 1_000,
    remediation: null,
    async analyze(input) {
      const browser = input.browser as BrowserRuntimeObservation | undefined;
      if (!browser || !Number.isSafeInteger(browser.pageCount)) {
        throw new Error("Missing browser observation");
      }
      return [
        createEvidence({
          checkId: "deep-browser-observation",
          checkVersion: "1.0.0",
          classification: "observation",
          confidence: 1,
          data: {
            statusCode: browser.statusCode,
            pageCount: browser.pageCount,
          },
        }),
      ];
    },
  });
  return registry;
}

/** Internal candidate path; the production Deep Audit dispatch gate stays closed. */
export async function analyzeAndPersistDeepObservations(input: {
  scanId: string;
  organizationId: string;
  siteId: string;
  targetUrl: string;
  profile: ScanProfile;
  authorization: AuthorizationDecision;
  scope: ScopeGuard;
  ledger: BudgetLedger;
  observations: DeepObservations;
}): Promise<readonly CheckRun[]> {
  if (input.profile.mode !== "verified_deep_audit") {
    throw new Error("Deep check profile required");
  }
  const runs = await runChecks({
    ...input,
    registry: createDeepCheckRegistry(),
    observations: input.observations,
  });
  await persistDeepCheckRuns({
    scanId: input.scanId,
    organizationId: input.organizationId,
    siteId: input.siteId,
    runs,
    ledger: input.ledger,
  });
  return runs;
}
