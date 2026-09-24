import net from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { DnsResolver } from "@agency-saas/security";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import {
  createGuardedBrowserSession,
  observeGuardedBrowserTarget,
} from "../src/scan-engine/guarded-browser-transport.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

function rawConnect(port: number, authority: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let response = "";
    const timer = setTimeout(
      () => socket.destroy(new Error("Proxy timeout")),
      2_000,
    );
    socket.setEncoding("utf8");
    socket.once("connect", () =>
      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      ),
    );
    socket.on("data", (chunk) => (response += chunk));
    socket.once("end", () => {
      clearTimeout(timer);
      resolve(response);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe("candidate guarded browser transport", () => {
  it("collects bounded DOM metadata without treating excluded third parties as global partial coverage", async () => {
    let onResponse: ((response: Response) => void) | undefined;
    const fakeResponse = {
      url: () => "https://example.com/",
      status: () => 200,
      headers: () => ({}),
      headersArray: async () => [
        {
          name: "Set-Cookie",
          value: "session=private; Secure; HttpOnly; SameSite=Lax",
        },
      ],
    } as unknown as Response;
    const fakePage = {
      on: (event: string, callback: (response: Response) => void) => {
        if (event === "response") onResponse = callback;
        return fakePage;
      },
      goto: async () => {
        onResponse?.(fakeResponse);
        return fakeResponse;
      },
      url: () => "https://example.com/?private=secret",
      evaluate: async () => ({
        resources: [
          {
            url: "https://cdn.example.net/app.js?token=secret",
            type: "script",
          },
        ],
        links: ["https://example.com/api?token=secret"],
        forms: [
          {
            action: "https://example.com/login?token=secret",
            method: "POST",
            passwordFields: 1,
            sensitiveFields: 1,
            csrfHint: true,
            autocomplete: "off",
            enctype: "application/x-www-form-urlencoded",
          },
        ],
        meta: [
          { name: "referrer", content: "no-referrer" },
          {
            name: "refresh",
            content: "0; url=https://example.com/next?token=secret",
          },
        ],
        iframeSandboxes: [
          { url: "https://other.example.net/frame", sandbox: "allow-scripts" },
        ],
        sri: [
          {
            url: "https://cdn.example.net/app.js?token=secret",
            integrityPresent: false,
            crossorigin: null,
          },
        ],
      }),
    } as unknown as Page;
    const fakeContext = {
      setDefaultNavigationTimeout: () => undefined,
      setDefaultTimeout: () => undefined,
      on: () => fakeContext,
      route: async () => undefined,
      routeWebSocket: async () => undefined,
      newPage: async () => fakePage,
      close: async () => undefined,
    } as unknown as BrowserContext;
    const fakeBrowser = {
      newContext: async () => fakeContext,
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
      launchBrowser: async () => fakeBrowser,
      signal: new AbortController().signal,
      beforeNetwork: async () => undefined,
    });
    expect(observation.finalUrl).toBe("https://example.com/");
    expect(observation.deep?.resources).toMatchObject([
      { url: "https://cdn.example.net/app.js", inScope: false, blocked: true },
    ]);
    expect(observation.deep?.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/api",
          source: "html-link",
          inScope: true,
        }),
        expect.objectContaining({
          url: "https://example.com/login",
          source: "form",
          method: "POST",
        }),
      ]),
    );
    expect(observation.deep?.forms).toMatchObject([
      { csrfHint: true, passwordFields: 1 },
    ]);
    expect(observation.deep?.cookies).toMatchObject([
      { name: "session", secure: true, httpOnly: true, sameSite: "Lax" },
    ]);
    expect(observation.deep?.meta).toEqual(
      expect.arrayContaining([
        { name: "refresh", content: "0" },
      ]),
    );
    expect(JSON.stringify(observation)).not.toContain("secret");
    expect(ledger.snapshot().reasons).not.toContain("scope-denied");
  });
  it("rejects navigation, redirect and subresource scope escapes before proxy DNS", async () => {
    let routeHandler: ((route: any) => Promise<void>) | undefined;
    const resolver = vi.fn<DnsResolver>(async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    const fakeContext = {
      setDefaultNavigationTimeout: () => undefined,
      setDefaultTimeout: () => undefined,
      on: () => fakeContext,
      route: async (
        _pattern: string,
        handler: (route: any) => Promise<void>,
      ) => {
        routeHandler = handler;
      },
      routeWebSocket: async () => undefined,
      close: async () => undefined,
    } as unknown as BrowserContext;
    const fakeBrowser = {
      newContext: async () => fakeContext,
      close: async () => undefined,
    } as unknown as Browser;
    const resolved = resolveScanProfile("verified_deep_audit");
    const profile = {
      ...resolved,
      budget: { ...resolved.budget, maxRequestsPerHostname: 2 },
    };
    const ledger = new BudgetLedger(profile.budget, Date.now());
    const session = await createGuardedBrowserSession({
      profile,
      authorization: { allowed: true, level: "deep" },
      scope: new ScopeGuard("https://example.com/"),
      ledger,
      resolver,
      launchBrowser: async () => fakeBrowser,
      signal: new AbortController().signal,
      beforeNetwork: async () => undefined,
    });
    const invoke = async (
      url: string,
      method = "GET",
      parent?: string,
      resourceType = "fetch",
    ) => {
      const continueRequest = vi.fn();
      const abort = vi.fn();
      await routeHandler?.({
        request: () => ({
          url: () => url,
          method: () => method,
          resourceType: () => resourceType,
          isNavigationRequest: () => true,
          redirectedFrom: () => (parent ? { url: () => parent } : null),
        }),
        continue: continueRequest,
        abort,
      });
      return {
        continued: continueRequest.mock.calls.length,
        aborted: abort.mock.calls.length,
      };
    };
    try {
      expect(await invoke("https://example.com/")).toMatchObject({
        continued: 1,
      });
      expect(await invoke("https://example.com/app.js")).toMatchObject({
        continued: 1,
      });
      expect(
        await invoke("https://example.com/third", "GET", undefined, "iframe"),
      ).toMatchObject({ aborted: 1 });
      expect(await invoke("https://cdn.example.com/app.js")).toMatchObject({
        aborted: 1,
      });
      expect(
        await invoke("https://other.example/", "GET", "https://example.com/"),
      ).toMatchObject({ aborted: 1 });
      expect(await invoke("https://example.com/api", "POST")).toMatchObject({
        aborted: 1,
      });
      for (const escaped of [
        "https://user:pass@example.com/",
        "https://example.com:8443/",
        "https://%31%32%37.0.0.1/",
        "https://[::1]/",
        "https://other.example/frame",
        "https://other.example/style.css",
        "https://other.example/font.woff2",
      ]) {
        expect(await invoke(escaped, "GET", undefined, "iframe")).toMatchObject(
          { aborted: 1 },
        );
      }
      expect(
        await rawConnect(session.proxy.port, "other.example:443"),
      ).toContain("403 Forbidden");
      expect(resolver).not.toHaveBeenCalled();
      expect(ledger.snapshot().used.httpRequests).toBe(2);
      expect(ledger.snapshot().reasons).not.toContain("scope-denied");
      expect(ledger.snapshot().reasons).toContain("budget-host-requests");
    } finally {
      await session.close();
    }
  });

  it("requires deep authorization before opening even the local proxy", async () => {
    const profile = resolveScanProfile("verified_deep_audit");
    const ledger = new BudgetLedger(profile.budget, Date.now());
    await expect(
      createGuardedBrowserSession({
        profile,
        authorization: { allowed: false, reason: "deep-grant-missing" },
        scope: new ScopeGuard("https://example.com/"),
        ledger,
      }),
    ).rejects.toThrow("authorization unavailable");
    expect(ledger.snapshot().reasons).toContain("authorization-unavailable");
  });
});
