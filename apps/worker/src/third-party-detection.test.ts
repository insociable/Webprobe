import { describe, expect, it } from "vitest";
import { detectThirdPartyServices } from "./third-party-detection.js";

describe("third-party technical detection", () => {
  it("requires a Cloudflare-specific header", () => {
    expect(
      detectThirdPartyServices({
        headers: { "cf-ray": "abc-CDG", server: "cloudflare" },
      }),
    ).toEqual([
      {
        providerId: "cloudflare",
        confidence: "high",
        evidence: ["Header CF-Ray observé", "Header Server: cloudflare"],
      },
    ]);
    expect(detectThirdPartyServices({ headers: { server: "nginx" } })).toEqual(
      [],
    );
  });

  it("detects multiple providers from observed resource domains and deduplicates", () => {
    const rows = detectThirdPartyServices({
      resources: [
        "https://js.stripe.com/v3/",
        "https://js.stripe.com/v3/?key=secret",
        "https://plausible.io/js/script.js",
        "https://browser.sentry-cdn.com/8.0.0/bundle.js",
      ],
    });
    expect(rows.map((row) => row.providerId)).toEqual([
      "stripe",
      "plausible",
      "sentry",
    ]);
    expect(rows[0]?.evidence).toEqual(["Ressource réseau : js.stripe.com/v3/"]);
    expect(rows.every((row) => row.confidence === "high")).toBe(true);
  });

  it("rejects text, lookalike domains and Next.js alone", () => {
    expect(
      detectThirdPartyServices({
        headers: { "x-powered-by": "Next.js" },
        resources: [
          "https://example.com/?footer=Cloudflare+Stripe",
          "https://js.stripe.com.evil.test/v3/",
          "https://example.com/_next/static/app.js",
        ],
      }),
    ).toEqual([]);
  });

  it("requires a Vercel-specific signal", () => {
    expect(
      detectThirdPartyServices({ headers: { "x-vercel-id": "cdg1::foo" } }),
    ).toEqual([
      {
        providerId: "vercel",
        confidence: "high",
        evidence: ["Header X-Vercel-Id observé"],
      },
    ]);
  });

  it("distinguishes Google Analytics from generic Tag Manager", () => {
    expect(
      detectThirdPartyServices({
        resources: ["https://www.googletagmanager.com/gtm.js?id=GTM-123"],
      }),
    ).toEqual([]);
    expect(
      detectThirdPartyServices({
        resources: ["https://www.googletagmanager.com/gtag/js?id=G-ABC123"],
      })[0]?.providerId,
    ).toBe("google-analytics");
  });
});
