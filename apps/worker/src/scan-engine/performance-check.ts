import type { BrowserRuntimeObservation } from "../browser-runtime.js";
import type { CheckDefinition } from "./check-registry.js";
import { createEvidence } from "./evidence.js";

export function createPerformanceCheck(): CheckDefinition {
  return {
    id: "deep-performance",
    version: "1.0.0",
    category: "performance",
    authorization: "deep",
    activity: "passive",
    modes: ["verified_deep_audit"],
    budget: {},
    requiredObservations: ["browser"],
    timeoutMs: 2000,
    remediation: null,
    async analyze(input, signal) {
      if (signal.aborted) throw new Error("Performance analysis aborted");
      const browser = input.browser as BrowserRuntimeObservation | undefined;
      const observed = browser?.deep?.performance;
      return [
        createEvidence({
          checkId: "deep-performance",
          checkVersion: "1.0.0",
          classification: "observation",
          confidence: observed?.coverage === "observed" ? 0.9 : 0.6,
          data: observed ?? {
            title: "Performance observée",
            summary:
              "Mesures de laboratoire indisponibles pour cette observation.",
            metricVersion: "2.0.0",
            coverage: "unavailable",
            findings: [],
            reasons: [
              browser?.deep?.performanceCollectionEnabled === false
                ? "collection-disabled"
                : "measurement-unavailable",
            ],
          },
        }),
      ];
    },
  };
}
