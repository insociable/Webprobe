import { describe, expect, it } from "vitest";
import { internalDeepWorkerEnabled } from "../src/internal-deep-worker.js";

describe("internal Deep worker gate", () => {
  it("is closed for absent, malformed, and production settings", () => {
    for (const env of [
      {},
      { WEBPROBE_INTERNAL_DEEP_WORKER: "enabled" },
      { WEBPROBE_RUNTIME_ENV: "preproduction" },
      {
        WEBPROBE_RUNTIME_ENV: "production",
        WEBPROBE_INTERNAL_DEEP_WORKER: "enabled",
      },
      {
        WEBPROBE_RUNTIME_ENV: "preproduction",
        WEBPROBE_INTERNAL_DEEP_WORKER: "true",
      },
    ])
      expect(internalDeepWorkerEnabled(env)).toBe(false);
  });

  it("accepts only the explicit server-side preproduction pair", () => {
    expect(
      internalDeepWorkerEnabled({
        WEBPROBE_RUNTIME_ENV: "preproduction",
        WEBPROBE_INTERNAL_DEEP_WORKER: "enabled",
      }),
    ).toBe(true);
  });
});
