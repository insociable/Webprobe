/// <reference lib="dom" />
import { chromium, type Browser, type Route } from "playwright";
import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { observeGuardedBrowserTarget } from "../src/scan-engine/guarded-browser-transport.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

describe("guarded real Chromium performance", () => {
  it.skipIf(process.env.RUN_BROWSER_INTEGRATION !== "1")(
    "installs before navigation, observes layout shifts and keeps blocked tiers visible without a target connection",
    async () => {
      const browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
      });
      const proofs: Array<{
        shift: boolean;
        cls: number | null;
        marker: string | null;
        count: number;
        durationMs: number;
      }> = [];
      try {
        for (const shift of [false, true]) {
          const profile = resolveScanProfile("verified_deep_audit");
          const ledger = new BudgetLedger(profile.budget, Date.now());
          let page: Awaited<ReturnType<Browser["newPage"]>> | undefined;
          let marker: string | null = null;
          let guardCalls = 0;
          const fulfilled: string[] = [];
          const fixtureBrowser = {
            newContext: async (
              options: Parameters<Browser["newContext"]>[0],
            ) => {
              const context = await browser.newContext(options);
              const nativeRoute = context.route.bind(context);
              context.route = async (pattern, handler) => {
                await nativeRoute(pattern, async (route) => {
                  const guardedRoute = {
                    request: () => route.request(),
                    abort: route.abort.bind(route),
                    continue: async () => {
                      const url = route.request().url();
                      expect(new URL(url).origin).toBe("https://example.com");
                      fulfilled.push(url);
                      const body =
                        "<!doctype html><html><head><script>document.documentElement.dataset.observer = window.__agencyMonitorLabPerformanceV2 ? 'ready' : 'missing';</script><script src='https://cdn.example.net/blocked.js'></script><style>body{margin:0;font:24px sans-serif}#spacer{height:10px}</style></head><body><div id='spacer'></div><p>Controlled visible fixture</p><script>" +
                        (shift
                          ? "requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>{document.getElementById('spacer').style.height='250px'},100)));"
                          : "") +
                        "</script></body></html>";
                      const accounted = ledger.reserve(
                        "bytesTransferred",
                        Buffer.byteLength(body),
                      ).allowed;
                      if (!accounted) {
                        await route.abort();
                        return;
                      }
                      await route.fulfill({
                        status: 200,
                        contentType: "text/html",
                        headers: { "cache-control": "private, no-store" },
                        body,
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
              const close = context.close.bind(context);
              context.close = async () => {
                if (page && !page.isClosed())
                  marker = await page.evaluate(
                    () => document.documentElement.dataset.observer ?? null,
                  );
                await close();
              };
              return context;
            },
            close: async () => {},
          } as unknown as Browser;
          const observed = await observeGuardedBrowserTarget({
            targetUrl: "https://example.com/",
            profile,
            authorization: { allowed: true, level: "deep" },
            scope: new ScopeGuard("https://example.com/"),
            ledger,
            launchBrowser: async () => fixtureBrowser,
            signal: new AbortController().signal,
            beforeNetwork: async () => {
              guardCalls++;
            },
          });
          const data = observed.deep?.performance;
          expect(marker).toBe("ready");
          expect(guardCalls).toBeGreaterThan(0);
          expect(fulfilled).toEqual(["https://example.com/"]);
          expect(ledger.snapshot().used.httpRequests).toBe(1);
          expect(data?.coverage).toBe("limited");
          expect(data?.reasons).toContain("blocked-resources");
          expect(data?.metrics.inpMs.value).toBeNull();
          expect(data?.context.windowEndMs).toBeGreaterThan(0);
          expect(data?.resources.blockedCount).toBe(1);
          expect(data?.metrics.fcpMs.value).toBeGreaterThan(0);
          const cls = data?.metrics.cls.value ?? null;
          if (shift) expect(cls).toBeGreaterThan(0);
          else expect(cls).toBe(0);
          proofs.push({
            shift,
            cls,
            marker,
            count: fulfilled.length,
            durationMs: observed.durationMs,
          });
        }
        console.log(
          JSON.stringify({ guardedFixtures: proofs, targetConnections: 0 }),
        );
      } finally {
        await browser.close();
      }
    },
    20000,
  );
});
