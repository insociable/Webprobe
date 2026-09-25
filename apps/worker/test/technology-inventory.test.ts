import { describe, expect, it } from "vitest";
import {
  detectTechnologyInventory,
  detectTechnologyObservations,
} from "../src/technology-inventory.js";

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
        server: "generic-proxy",
        "x-powered-by": "custom-runtime",
      }),
    ).toEqual([]);
  });

  it("inventories explicit infrastructure without pretending a version exists", () => {
    expect(
      detectTechnologyObservations({
        server: "cloudflare",
        "cf-ray": "example",
        "x-powered-by": "Express",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vendor: "cloudflare",
          product: "cloudflare",
          version: null,
          versionConfidence: "unknown",
          detectionConfidence: "high",
        }),
        expect.objectContaining({
          vendor: "expressjs",
          product: "express",
          version: null,
          versionConfidence: "unknown",
          detectionConfidence: "high",
        }),
      ]),
    );
  });

  it("uses independent passive browser signals before identifying WordPress", () => {
    expect(
      detectTechnologyInventory({
        browser: { resources: ["https://example.test/wp-content/app.css"] },
      }),
    ).toEqual([]);

    expect(
      detectTechnologyInventory({
        browser: {
          resources: [
            "https://example.test/wp-content/app.css",
            "https://example.test/wp-includes/js/wp-emoji.js",
          ],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        vendor: "wordpress",
        product: "wordpress",
        version: null,
        detectionConfidence: "high",
        source: "browser_signature",
      }),
    ]);
  });

  it("accepts an explicit generator version without fabricating missing detail", () => {
    expect(
      detectTechnologyInventory({
        browser: {
          meta: [{ name: "generator", content: "WordPress 6.6.1" }],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        vendor: "wordpress",
        version: "6.6.1",
        versionConfidence: "exact",
        detectionConfidence: "high",
      }),
    ]);
  });

  it("recognizes Next.js only after multiple framework-specific assets", () => {
    expect(
      detectTechnologyInventory({
        browser: {
          resources: [
            "https://example.test/_next/static/chunks/main.js",
            "https://example.test/_next/static/chunks/framework.js",
          ],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        vendor: "vercel",
        product: "next.js",
        version: null,
        detectionConfidence: "high",
      }),
    ]);
  });
});
