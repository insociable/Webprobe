import { describe, expect, it } from "vitest";
import { internalDeepWorkerEnabled } from "../src/internal-deep-worker.js";

describe("internal Deep worker gate", () => {
  it("is closed unless both the runtime and explicit Deep switch are valid", () => {
    for (const env of [
      {},
      { WEBPROBE_INTERNAL_DEEP_WORKER: "enabled" },
      { WEBPROBE_RUNTIME_ENV: "preproduction" },
      {
        WEBPROBE_RUNTIME_ENV: "production",
        WEBPROBE_INTERNAL_DEEP_WORKER: "true",
      },
      {
        WEBPROBE_RUNTIME_ENV: "preproduction",
        WEBPROBE_INTERNAL_DEEP_WORKER: "true",
      },
    ])
      expect(internalDeepWorkerEnabled(env)).toBe(false);
  });

  it.each(["preproduction", "production"])(
    "accepts the explicit server-side gate in %s",
    (runtime) => {
      expect(
        internalDeepWorkerEnabled({
          WEBPROBE_RUNTIME_ENV: runtime,
          WEBPROBE_INTERNAL_DEEP_WORKER: "enabled",
        }),
      ).toBe(true);
    },
  );
});
