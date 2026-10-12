/// <reference lib="dom" />
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { collectCspPolicies } from "../src/http-probe.js";
import {
  allowsArbitraryInline,
  effectiveDirective,
  observedCspPolicies,
} from "../src/scan-engine/deep-policy-analysis.js";

describe("passive CSP browser semantics", () => {
  it.skipIf(process.env.RUN_BROWSER_INTEGRATION !== "1")(
    "matches Chromium on malformed nonce/hash and strict-dynamic without any target connection",
    async () => {
      const browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
      });
      const cases = [
        ["script-src 'unsafe-inline' 'nonce-!!!'", true],
        ["script-src 'unsafe-inline' 'nonce-YWJj'", false],
        ["script-src 'unsafe-inline' 'strict-dynamic'", false],
        ["script-src 'unsafe-inline' 'sha256-!!!'", true],
        ["script-src 'unsafe-inline' 'sha256-YQ=='", false],
      ] as const;
      try {
        for (const [csp, expected] of cases) {
          const context = await browser.newContext({ serviceWorkers: "block" });
          let fixtureRequests = 0;
          try {
            // Trusted static fixture: all requests are intercepted; no DNS/TCP or real target.
            await context.route("**/*", async (route) => {
              if (route.request().url() !== "https://fixture.example.test/") {
                await route.abort();
                return;
              }
              fixtureRequests++;
              await route.fulfill({
                status: 200,
                contentType: "text/html",
                headers: { "content-security-policy": csp },
                body: "<script>window.fixtureRan=true</script>",
              });
            });
            const page = await context.newPage();
            await page.goto("https://fixture.example.test/");
            expect(await page.evaluate("window.fixtureRan===true")).toBe(
              expected,
            );
            const policies = observedCspPolicies({
              ok: true,
              finalUrl: "https://fixture.example.test/",
              statusCode: 200,
              durationMs: 1,
              redirects: [],
              headers: {},
              securityHeaders: [],
              tls: null,
              cspPolicies: collectCspPolicies({
                "content-security-policy": csp,
              }),
            });
            expect(
              allowsArbitraryInline(
                effectiveDirective(policies.enforced[0]!, "script-src"),
              ),
            ).toBe(expected);
            expect(fixtureRequests).toBe(1);
          } finally {
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }
    },
  );
});
