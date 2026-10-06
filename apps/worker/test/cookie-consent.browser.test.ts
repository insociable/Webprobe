/// <reference lib="dom" />
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Route,
} from "playwright";
import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { observeGuardedBrowserTarget } from "../src/scan-engine/guarded-browser-transport.js";
import { assessCookieConsent } from "../src/scan-engine/cookie-consent-analysis.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

describe("real Chromium cookie observation", () => {
  it.skipIf(process.env.RUN_BROWSER_INTEGRATION !== "1")(
    "observes accepted HTTP and delayed JS cookies in a fresh context without clicking or allowing third-party requests",
    async () => {
      const fulfilled: string[] = [];
      const contextCookieCounts: number[] = [];
      let page: Awaited<ReturnType<BrowserContext["newPage"]>> | undefined;
      let consentClicks: number | undefined;
      const browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
      });
      try {
        // Trusted fixture seam: fulfill only after the production route guard
        // allows a request. No DNS, TCP connection or external site is involved.
        const fixtureBrowser = {
          newContext: async (options: Parameters<Browser["newContext"]>[0]) => {
            const context = await browser.newContext(options);
            contextCookieCounts.push((await context.cookies()).length);
            const originalRoute = context.route.bind(context);
            context.route = async (pattern, handler) => {
              await originalRoute(pattern, async (route) => {
                const guardedRoute = {
                  request: () => route.request(),
                  abort: route.abort.bind(route),
                  continue: async () => {
                    const url = route.request().url();
                    fulfilled.push(url);
                    expect(new URL(url).hostname).toBe("example.com");
                    await route.fulfill({
                      status: 200,
                      contentType: "text/html",
                      headers: {
                        "set-cookie":
                          "_gcl_au=http-secret; Secure; HttpOnly; SameSite=Lax; Path=/",
                      },
                      body: `<!doctype html><html><head><title>Consent fixture</title>
                        <script src="https://cdn.example.net/blocked.js"></script>
                        <script>
                          window.consentClicks = 0;
                          setTimeout(() => { document.cookie = "_clck=js-secret; Secure; SameSite=Lax; Path=/"; }, 300);
                        </script></head><body>
                        <button id="accept" onclick="window.consentClicks++; document.cookie='_ga=consented-secret; Secure; Path=/'">Accepter</button>
                        </body></html>`,
                    });
                  },
                } as unknown as Route;
                await handler(guardedRoute, route.request());
              });
            };
            const newPage = context.newPage.bind(context);
            context.newPage = async () => {
              page = await newPage();
              return page;
            };
            // Inspect before closing; the production collector has no clicks.
            const close = context.close.bind(context);
            context.close = async () => {
              if (page && !page.isClosed())
                consentClicks = await page.evaluate(
                  () =>
                    (window as unknown as { consentClicks: number })
                      .consentClicks,
                );
              await close();
            };
            return context;
          },
          close: async () => undefined,
        } as unknown as Browser;
        const profile = resolveScanProfile("verified_deep_audit");
        const ledger = new BudgetLedger(profile.budget, Date.now());
        const observation = await observeGuardedBrowserTarget({
          targetUrl: "https://example.com/",
          profile,
          authorization: { allowed: true, level: "deep" },
          scope: new ScopeGuard("https://example.com/"),
          ledger,
          launchBrowser: async () => fixtureBrowser,
          signal: new AbortController().signal,
          beforeNetwork: async () => undefined,
        });
        expect(contextCookieCounts).toEqual([0]);
        expect(consentClicks).toBe(0);
        expect(observation.deep?.cookieConsent).toMatchObject({
          status: "observed",
          cookies: expect.arrayContaining([
            expect.objectContaining({ name: "_gcl_au", httpOnly: true }),
            expect.objectContaining({ name: "_clck", httpOnly: false }),
          ]),
        });
        expect(
          observation.deep?.cookieConsent?.cookies.map((item) => item.name),
        ).not.toContain("_ga");
        expect(observation.deep?.excludedThirdPartyRequests).toBe(1);
        expect(fulfilled).toEqual(["https://example.com/"]);
        expect(ledger.snapshot().reasons).not.toContain("scope-denied");
        const assessment = assessCookieConsent(
          observation.deep?.cookieConsent,
          1,
        );
        expect(assessment.findings).toHaveLength(2);
        expect(JSON.stringify({ observation, assessment })).not.toContain(
          "secret",
        );
      } finally {
        await browser.close();
      }
    },
    15_000,
  );
});
