import net from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { DnsResolver } from "@agency-saas/security";
import {
  resolveSafeConnectTarget,
  resolveSafeProxyTarget,
  startSafeBrowserProxy,
} from "../src/safe-browser-proxy.js";

const publicResolver: DnsResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

function rawProxyRequest(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy(new Error("proxy test timed out"));
    }, 2_000);

    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(payload));
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.once("end", () => {
      clearTimeout(timeout);
      resolve(response);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

describe("safe browser egress proxy", () => {
  it("closes established CONNECT tunnels at the stream lifetime limit", async () => {
    const upstream = net.createServer(() => undefined);
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const originalConnect = net.connect.bind(net);
    const spy = vi
      .spyOn(net, "connect")
      .mockImplementation(((options: net.NetConnectOpts) =>
        originalConnect(
          options.host === "93.184.216.34"
            ? { host: "127.0.0.1", port: address.port }
            : options,
        )) as typeof net.connect);
    let proxy: Awaited<ReturnType<typeof startSafeBrowserProxy>> | undefined;
    try {
      proxy = await startSafeBrowserProxy({
        resolver: publicResolver,
        maxTunnelLifetimeMs: 50,
      });
      const port = proxy.port;
      const result = await new Promise<string>((resolve, reject) => {
        const socket = originalConnect({ host: "127.0.0.1", port });
        let received = "";
        const timeout = setTimeout(
          () => reject(new Error("Tunnel remained open")),
          1_000,
        );
        socket.setEncoding("utf8");
        socket.once("connect", () =>
          socket.write(
            "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
          ),
        );
        socket.on("data", (chunk) => {
          received += chunk;
        });
        socket.once("error", () => undefined);
        socket.once("close", () => {
          clearTimeout(timeout);
          resolve(received);
        });
      });
      expect(result).toContain("200 Connection Established");
    } finally {
      if (proxy) await proxy.close();
      spy.mockRestore();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
  it("closes CONNECT when the per-tunnel or aggregate byte budget is spent", async () => {
    const upstream = net.createServer(() => undefined);
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const originalConnect = net.connect.bind(net);
    const spy = vi
      .spyOn(net, "connect")
      .mockImplementation(((options: net.NetConnectOpts) =>
        originalConnect(
          options.host === "93.184.216.34"
            ? { host: "127.0.0.1", port: address.port }
            : options,
        )) as typeof net.connect);
    try {
      for (const limits of [
        { maxTunnelBytes: 16, maxTotalTransferredBytes: 100 },
        { maxTunnelBytes: 100, maxTotalTransferredBytes: 16 },
      ]) {
        const proxy = await startSafeBrowserProxy({
          resolver: publicResolver,
          ...limits,
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const socket = originalConnect({
              host: "127.0.0.1",
              port: proxy.port,
            });
            const timeout = setTimeout(
              () => reject(new Error("Byte budget not enforced")),
              1_000,
            );
            socket.once("connect", () =>
              socket.write(
                "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
              ),
            );
            socket.on("data", (chunk: Buffer) => {
              if (chunk.toString().includes("200 Connection Established")) {
                socket.write(Buffer.alloc(32));
              }
            });
            socket.once("error", () => undefined);
            socket.once("close", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        } finally {
          await proxy.close();
        }
      }
    } finally {
      spy.mockRestore();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
  it("pins an allowed HTTP target to a validated public address", async () => {
    const target = await resolveSafeProxyTarget(
      "http://example.com/path?q=1",
      publicResolver,
    );

    expect(target).toMatchObject({
      address: "93.184.216.34",
      family: 4,
      port: 80,
    });
    expect(target.url.hostname).toBe("example.com");
  });

  it("rejects a target when any DNS answer is non-public", async () => {
    const resolver: DnsResolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];

    await expect(
      resolveSafeProxyTarget("https://example.com/", resolver),
    ).rejects.toMatchObject({ code: "non-public-ip" });
  });

  it("accepts CONNECT only on standard HTTPS", async () => {
    await expect(
      resolveSafeConnectTarget("example.com:443", publicResolver),
    ).resolves.toMatchObject({
      address: "93.184.216.34",
      port: 443,
    });

    await expect(
      resolveSafeConnectTarget("example.com:8443", publicResolver),
    ).rejects.toThrow();
  });

  it("blocks loopback CONNECT before opening an upstream socket", async () => {
    const proxy = await startSafeBrowserProxy();

    try {
      const response = await rawProxyRequest(
        proxy.port,
        ["CONNECT 127.0.0.1:443 HTTP/1.1", "Host: 127.0.0.1:443", "", ""].join(
          "\r\n",
        ),
      );

      expect(response).toContain("403 Forbidden");
    } finally {
      await proxy.close();
    }
  });
  it("rejects non-idempotent HTTP methods without forwarding them", async () => {
    const proxy = await startSafeBrowserProxy({ resolver: publicResolver });

    try {
      const response = await rawProxyRequest(
        proxy.port,
        [
          "POST http://example.com/ HTTP/1.1",
          "Host: example.com",
          "Content-Length: 0",
          "",
          "",
        ].join("\r\n"),
      );

      expect(response).toContain("405 Method Not Allowed");
    } finally {
      await proxy.close();
    }
  });

  it("rejects private HTTP proxy targets", async () => {
    const proxy = await startSafeBrowserProxy();

    try {
      const response = await rawProxyRequest(
        proxy.port,
        [
          "GET http://169.254.169.254/latest/meta-data/ HTTP/1.1",
          "Host: 169.254.169.254",
          "",
          "",
        ].join("\r\n"),
      );

      expect(response).toContain("403 Forbidden");
    } finally {
      await proxy.close();
    }
  });
});
