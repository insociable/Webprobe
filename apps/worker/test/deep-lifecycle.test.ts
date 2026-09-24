import { describe, expect, it, vi } from "vitest";
import net from "node:net";
import type { Browser, BrowserContext, Page } from "playwright";
import type { HttpRequester } from "../src/http-probe.js";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { observeGuardedBrowserTarget } from "../src/scan-engine/guarded-browser-transport.js";
import { probeGuardedHttpTarget } from "../src/scan-engine/guarded-http-transport.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";
import { startSafeBrowserProxy } from "../src/safe-browser-proxy.js";

const profile = resolveScanProfile("verified_deep_audit");
const authorization = { allowed: true as const, level: "deep" as const };
const scope = new ScopeGuard("https://example.com/");
const publicDns = async () => [
  { address: "93.184.216.34", family: 4 as const },
];

function httpInput(
  signal: AbortSignal,
  resolver = publicDns,
  requester?: HttpRequester,
) {
  return {
    targetUrl: "https://example.com/",
    profile,
    authorization,
    scope,
    ledger: new BudgetLedger(profile.budget, Date.now()),
    signal,
    beforeNetwork: async () => undefined,
    transport: { resolver, ...(requester ? { requester } : {}) },
  };
}

describe("Deep lifecycle abort boundaries", () => {
  it("refuses a Deep transport without an execution guard", async () => {
    const controller = new AbortController();
    const dns = vi.fn(publicDns);
    const { beforeNetwork: _guard, ...unguarded } = httpInput(
      controller.signal,
      dns,
    );
    await expect(
      probeGuardedHttpTarget({
        ...unguarded,
      }),
    ).rejects.toThrow("authorization-unavailable");
    expect(dns).not.toHaveBeenCalled();
  });
  it("rejects cancellation before any DNS or HTTP", async () => {
    const controller = new AbortController();
    controller.abort();
    const resolver = vi.fn(publicDns);
    const requester = vi.fn<HttpRequester>(async () => {
      throw new Error("unexpected");
    });
    await expect(
      probeGuardedHttpTarget(httpInput(controller.signal, resolver, requester)),
    ).rejects.toThrow("aborted");
    expect(resolver).not.toHaveBeenCalled();
    expect(requester).not.toHaveBeenCalled();
  });

  it("interrupts DNS and never enters the HTTP requester", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resolver = vi.fn(async () => {
      entered();
      return new Promise<Awaited<ReturnType<typeof publicDns>>>(
        () => undefined,
      );
    });
    const requester = vi.fn<HttpRequester>(async () => {
      throw new Error("unexpected");
    });
    const running = probeGuardedHttpTarget(
      httpInput(controller.signal, resolver, requester),
    );
    await started;
    controller.abort();
    await expect(running).rejects.toThrow("aborted");
    expect(requester).not.toHaveBeenCalled();
  });

  it("interrupts a pending HTTP request and does not follow a redirect", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const requester = vi.fn<HttpRequester>(
      async (_target, _timeout, _account, signal) => {
        expect(signal).toBe(controller.signal);
        entered();
        return new Promise(() => undefined);
      },
    );
    const running = probeGuardedHttpTarget(
      httpInput(controller.signal, publicDns, requester),
    );
    await started;
    controller.abort();
    await expect(running).rejects.toThrow("aborted");
    expect(requester).toHaveBeenCalledOnce();
  });

  it("rechecks authorization before DNS and blocks a revoked grant", async () => {
    const controller = new AbortController();
    const resolver = vi.fn(publicDns);
    const requester = vi.fn<HttpRequester>(async () => {
      throw new Error("unexpected");
    });
    await expect(
      probeGuardedHttpTarget({
        ...httpInput(controller.signal, resolver, requester),
        beforeNetwork: async () => {
          throw new Error("grant revoked");
        },
      }),
    ).rejects.toThrow("grant revoked");
    expect(resolver).not.toHaveBeenCalled();
    expect(requester).not.toHaveBeenCalled();
  });

  it("closes Chromium and proxy during navigation", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const closeBrowser = vi.fn(async () => undefined);
    const closeContext = vi.fn(async () => undefined);
    const page = {
      goto: async () => {
        entered();
        return new Promise(() => undefined);
      },
      url: () => "https://example.com/",
      on: () => page,
      close: async () => undefined,
    } as unknown as Page;
    const context = {
      setDefaultNavigationTimeout: () => undefined,
      setDefaultTimeout: () => undefined,
      on: () => context,
      route: async () => undefined,
      routeWebSocket: async () => undefined,
      newPage: async () => page,
      close: closeContext,
    } as unknown as BrowserContext;
    const browser = {
      newContext: async () => context,
      close: closeBrowser,
    } as unknown as Browser;
    const running = observeGuardedBrowserTarget({
      targetUrl: "https://example.com/",
      profile,
      authorization,
      scope,
      ledger: new BudgetLedger(profile.budget, Date.now()),
      resolver: publicDns,
      launchBrowser: async () => browser,
      signal: controller.signal,
      beforeNetwork: async () => undefined,
    });
    await started;
    controller.abort();
    await expect(running).rejects.toThrow("aborted");
    expect(closeContext).toHaveBeenCalled();
    expect(closeBrowser).toHaveBeenCalled();
  });

  it("destroys an open proxy client socket on cancellation", async () => {
    const controller = new AbortController();
    const proxy = await startSafeBrowserProxy({ signal: controller.signal });
    const socket = net.connect({ host: "127.0.0.1", port: proxy.port });
    socket.on("error", () => undefined);
    try {
      await new Promise<void>((resolve) => socket.once("connect", resolve));
      const closed = new Promise<void>((resolve) =>
        socket.once("close", resolve),
      );
      controller.abort();
      await closed;
      expect(socket.destroyed).toBe(true);
    } finally {
      socket.destroy();
      await proxy.close();
    }
  });
});
