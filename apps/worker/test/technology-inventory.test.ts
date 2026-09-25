import { describe, expect, it } from "vitest";
import { detectTechnologyObservations } from "../src/technology-inventory.js";

describe("technology inventory", () => {
  it("recognizes exact nginx versions from the Server header", () => {
    expect(
      detectTechnologyObservations({ server: "nginx/1.24.0 (Ubuntu)" }),
    ).toEqual([
      expect.objectContaining({
        vendor: "nginx",
        product: "nginx",
        version: "1.24.0",
        versionConfidence: "exact",
        detectionConfidence: "high",
      }),
    ]);
  });

  it("keeps missing or partial versions non-exact", () => {
    const [missing] = detectTechnologyObservations({ server: "Apache" });
    const [partial] = detectTechnologyObservations({ "x-powered-by": "PHP/8" });
    expect(missing).toMatchObject({
      vendor: "apache",
      product: "http_server",
      version: null,
      versionConfidence: "unknown",
    });
    expect(partial).toMatchObject({
      vendor: "php",
      product: "php",
      version: "8",
      versionConfidence: "partial",
    });
  });

  it("does not infer unsupported products from generic headers", () => {
    expect(
      detectTechnologyObservations({
        server: "cloudflare",
        "x-powered-by": "Express",
      }),
    ).toEqual([]);
  });
});
