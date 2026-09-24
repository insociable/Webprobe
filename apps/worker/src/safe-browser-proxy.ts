import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import net, { type Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
  assertPublicHttpUrl,
  defaultDnsResolver,
  type DnsResolver,
} from "@agency-saas/security";

const alwaysAllowedHttpMethods = new Set(["GET", "HEAD"]);
const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export type SafeProxyTarget = {
  url: URL;
  address: string;
  family: 4 | 6;
  port: 80 | 443;
};

export type SafeBrowserProxyOptions = {
  resolver?: DnsResolver;
  /** V3 defense at the proxy boundary, before DNS resolution or a TCP connect. */
  allowTarget?: (url: URL) => boolean;
  stillAllowed?: (url: URL) => boolean;
  /** V3 shared byte ledger. Returning false closes the connection before forwarding. */
  accountBytes?: (bytes: number) => boolean;
  maxLifetimeMs?: number;
  connectTimeoutMs?: number;
  maxConnections?: number;
  maxHttpResponseBytes?: number;
  maxHttpResponseMs?: number;
  maxTunnelDurationMs?: number;
  maxTunnelLifetimeMs?: number;
  maxTunnelBytes?: number;
  maxTotalTransferredBytes?: number;
  maxRequests?: number;
  maxRequestsPerHostname?: number;
  allowOptions?: boolean;
};

export type SafeBrowserProxy = {
  url: string;
  port: number;
  close(): Promise<void>;
};

function addressFamily(address: string): 4 | 6 {
  return address.includes(":") ? 6 : 4;
}

function filteredHeaders(
  headers: IncomingHttpHeaders,
  dropHost = false,
): OutgoingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(([name, value]) => {
      if (value === undefined) {
        return false;
      }
      const normalized = name.toLowerCase();
      if (hopByHopHeaders.has(normalized)) {
        return false;
      }
      return !dropHost || normalized !== "host";
    }),
  );
}

function headerBytes(rawHeaders: readonly string[]): number {
  let bytes = 2;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    bytes += Buffer.byteLength(
      `${rawHeaders[index]}: ${rawHeaders[index + 1]}\r\n`,
    );
  }
  return bytes;
}

export async function resolveSafeProxyTarget(
  rawUrl: string,
  resolver: DnsResolver = defaultDnsResolver,
): Promise<SafeProxyTarget> {
  const validated = await assertPublicHttpUrl(rawUrl, resolver);
  const address = validated.addresses[0];
  if (!address) {
    throw new Error("Validated proxy target has no pinned address");
  }

  return {
    url: validated.url,
    address,
    family: addressFamily(address),
    port: validated.url.protocol === "https:" ? 443 : 80,
  };
}

export async function resolveSafeConnectTarget(
  authority: string,
  resolver: DnsResolver = defaultDnsResolver,
): Promise<SafeProxyTarget> {
  let url: URL;
  try {
    url = new URL(`https://${authority}/`);
  } catch {
    throw new Error("Invalid CONNECT authority");
  }

  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    throw new Error("CONNECT target must use standard HTTPS");
  }

  return resolveSafeProxyTarget(url.toString(), resolver);
}

function endHttpError(
  response: ServerResponse,
  statusCode: number,
  message: string,
): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }

  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    connection: "close",
  });
  response.end(message);
}

function endConnectError(
  socket: Duplex,
  statusCode: 400 | 403 | 429 | 502 | 504,
  statusText: string,
): void {
  if (socket.destroyed) {
    return;
  }
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`,
  );
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    allowTarget: SafeBrowserProxyOptions["allowTarget"];
    stillAllowed: SafeBrowserProxyOptions["stillAllowed"];
    accountBytes: SafeBrowserProxyOptions["accountBytes"];
  } & Required<
    Pick<
      SafeBrowserProxyOptions,
      | "resolver"
      | "connectTimeoutMs"
      | "maxHttpResponseBytes"
      | "maxHttpResponseMs"
      | "allowOptions"
    >
  >,
  consumeBytes: (bytes: number) => boolean,
  consumeRequest: (hostname: string) => boolean,
): Promise<void> {
  const method = request.method ?? "GET";
  if (
    !alwaysAllowedHttpMethods.has(method) &&
    !(options.allowOptions && method === "OPTIONS")
  ) {
    request.resume();
    endHttpError(response, 405, "Method not allowed");
    return;
  }

  const rawUrl = request.url;
  if (!rawUrl?.startsWith("http://")) {
    request.resume();
    endHttpError(response, 400, "Absolute HTTP proxy URL required");
    return;
  }

  if (options.allowTarget) {
    try {
      if (!options.allowTarget(new URL(rawUrl)))
        throw new Error("Out of scope");
    } catch {
      request.resume();
      endHttpError(response, 403, "Proxy target outside scope");
      return;
    }
  }

  let target: SafeProxyTarget;
  try {
    target = await resolveSafeProxyTarget(rawUrl, options.resolver);
  } catch {
    request.resume();
    endHttpError(response, 403, "Unsafe proxy target");
    return;
  }

  if (target.url.protocol !== "http:" || target.port !== 80) {
    request.resume();
    endHttpError(response, 400, "HTTPS must use CONNECT");
    return;
  }
  if (options.stillAllowed && !options.stillAllowed(target.url)) {
    request.resume();
    endHttpError(response, 403, "Proxy target no longer allowed");
    return;
  }
  if (!consumeRequest(target.url.hostname)) {
    request.resume();
    endHttpError(response, 429, "Request budget exceeded");
    return;
  }

  const headers = filteredHeaders(request.headers, true);
  headers.host = target.url.host;
  headers.connection = "close";
  const requestHeaderBytes =
    Buffer.byteLength(
      `${method} ${target.url.pathname}${target.url.search} HTTP/1.1\r\n`,
    ) + headerBytes(request.rawHeaders);
  if (options.accountBytes && !consumeBytes(requestHeaderBytes)) {
    request.resume();
    endHttpError(response, 429, "Byte budget exceeded");
    return;
  }

  await new Promise<void>((resolve) => {
    let finished = false;
    let connectTimer: NodeJS.Timeout | undefined;
    let responseTimer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (responseTimer) clearTimeout(responseTimer);
      resolve();
    };
    const upstream = http.request(
      {
        host: target.address,
        family: target.family,
        port: 80,
        method,
        path: `${target.url.pathname}${target.url.search}`,
        headers,
        setHost: false,
      },
      (upstreamResponse) => {
        upstreamResponse.once("end", finish);
        upstreamResponse.once("error", finish);
        const responseHeaders = filteredHeaders(upstreamResponse.headers);
        const responseHeaderBytes =
          Buffer.byteLength(
            `HTTP/1.1 ${upstreamResponse.statusCode ?? 502}\r\n`,
          ) + headerBytes(upstreamResponse.rawHeaders);
        if (options.accountBytes && !consumeBytes(responseHeaderBytes)) {
          upstreamResponse.destroy();
          response.destroy();
          finish();
          return;
        }
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        let bytes = 0;
        upstreamResponse.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (
            bytes > options.maxHttpResponseBytes ||
            !consumeBytes(chunk.length)
          ) {
            upstreamResponse.destroy();
            response.destroy();
            return;
          }
          if (options.accountBytes) {
            if (response.destroyed) {
              upstreamResponse.destroy();
              return;
            }
            if (!response.write(chunk)) upstreamResponse.pause();
          }
        });
        if (options.accountBytes)
          response.on("drain", () => upstreamResponse.resume());
        if (options.accountBytes) {
          upstreamResponse.once("end", () => response.end());
        } else {
          upstreamResponse.pipe(response);
        }
      },
    );

    connectTimer = setTimeout(() => {
      const error = new Error(
        "Proxy upstream timeout",
      ) as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      upstream.destroy(error);
    }, options.connectTimeoutMs);

    upstream.once("socket", (socket) => {
      socket.once("connect", () => {
        if (connectTimer) clearTimeout(connectTimer);
      });
    });
    responseTimer = setTimeout(() => {
      upstream.destroy();
      if (!response.destroyed) response.destroy();
      finish();
    }, options.maxHttpResponseMs);
    upstream.once("error", (error: NodeJS.ErrnoException) => {
      const status = error.code === "ETIMEDOUT" ? 504 : 502;
      endHttpError(response, status, "Upstream connection failed");
      finish();
    });

    request.once("aborted", () => {
      upstream.destroy();
      finish();
    });
    response.once("close", () => {
      upstream.destroy();
      finish();
    });
    request.resume();
    upstream.end();
  });
}

async function handleConnect(
  request: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  options: {
    allowTarget: SafeBrowserProxyOptions["allowTarget"];
    stillAllowed: SafeBrowserProxyOptions["stillAllowed"];
    accountBytes: SafeBrowserProxyOptions["accountBytes"];
  } & Required<
    Pick<
      SafeBrowserProxyOptions,
      "resolver" | "connectTimeoutMs" | "maxTunnelDurationMs" | "maxTunnelBytes"
    >
  >,
  upstreamSockets: Set<Socket>,
  consumeBytes: (bytes: number) => boolean,
  consumeRequest: (hostname: string) => boolean,
): Promise<void> {
  const authority = request.url ?? "";
  if (options.allowTarget) {
    try {
      if (!options.allowTarget(new URL(`https://${authority}/`))) {
        throw new Error("Out of scope");
      }
    } catch {
      endConnectError(clientSocket, 403, "Forbidden");
      return;
    }
  }
  let target: SafeProxyTarget;
  try {
    target = await resolveSafeConnectTarget(authority, options.resolver);
  } catch {
    endConnectError(clientSocket, 403, "Forbidden");
    return;
  }

  if (target.port !== 443) {
    endConnectError(clientSocket, 403, "Forbidden");
    return;
  }
  if (options.stillAllowed && !options.stillAllowed(target.url)) {
    endConnectError(clientSocket, 403, "Forbidden");
    return;
  }
  if (!consumeRequest(target.url.hostname)) {
    endConnectError(clientSocket, 429, "Too Many Requests");
    return;
  }

  const upstream = net.connect({
    host: target.address,
    family: target.family,
    port: 443,
  });
  upstreamSockets.add(upstream);

  const timeout = setTimeout(() => {
    upstream.destroy();
    endConnectError(clientSocket, 504, "Gateway Timeout");
  }, options.connectTimeoutMs);
  let tunnelTimer: NodeJS.Timeout | undefined;
  let tunneledBytes = head.length;

  const closeTunnel = () => {
    upstream.destroy();
    clientSocket.destroy();
  };
  const accountTunnelBytes = (chunk: Buffer): boolean => {
    tunneledBytes += chunk.length;
    if (tunneledBytes > options.maxTunnelBytes || !consumeBytes(chunk.length)) {
      closeTunnel();
      return false;
    }
    return true;
  };

  upstream.once("connect", () => {
    clearTimeout(timeout);
    if (clientSocket.destroyed) {
      upstream.destroy();
      return;
    }

    clientSocket.write(
      "HTTP/1.1 200 Connection Established\r\nProxy-Agent: AgencyMonitor\r\n\r\n",
    );
    if (head.length > options.maxTunnelBytes || !consumeBytes(head.length)) {
      closeTunnel();
      return;
    }
    tunnelTimer = setTimeout(closeTunnel, options.maxTunnelDurationMs);
    if (options.accountBytes) {
      clientSocket.on("data", (chunk: Buffer) => {
        if (accountTunnelBytes(chunk) && !upstream.write(chunk))
          clientSocket.pause();
      });
      upstream.on("data", (chunk: Buffer) => {
        if (accountTunnelBytes(chunk) && !clientSocket.write(chunk))
          upstream.pause();
      });
      upstream.on("drain", () => clientSocket.resume());
      clientSocket.on("drain", () => upstream.resume());
      clientSocket.on("end", () => upstream.end());
      upstream.on("end", () => clientSocket.end());
    } else {
      clientSocket.on("data", accountTunnelBytes);
      upstream.on("data", accountTunnelBytes);
    }
    if (head.length > 0) {
      upstream.write(head);
    }
    if (!options.accountBytes) {
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    }
  });

  const clearTunnelTimer = () => {
    if (tunnelTimer) clearTimeout(tunnelTimer);
  };
  upstream.once("error", () => {
    clearTimeout(timeout);
    clearTunnelTimer();
    endConnectError(clientSocket, 502, "Bad Gateway");
  });
  upstream.once("close", () => {
    clearTunnelTimer();
    upstreamSockets.delete(upstream);
  });
  clientSocket.once("close", () => {
    clearTunnelTimer();
    upstream.destroy();
  });
  clientSocket.once("error", () => upstream.destroy());
}

export async function startSafeBrowserProxy(
  options: SafeBrowserProxyOptions = {},
): Promise<SafeBrowserProxy> {
  const resolvedOptions = {
    resolver: options.resolver ?? defaultDnsResolver,
    allowTarget: options.allowTarget,
    stillAllowed: options.stillAllowed,
    accountBytes: options.accountBytes,
    maxLifetimeMs: options.maxLifetimeMs,
    connectTimeoutMs: options.connectTimeoutMs ?? 10_000,
    maxConnections: options.maxConnections ?? 64,
    maxHttpResponseBytes: options.maxHttpResponseBytes ?? 10 * 1024 * 1024,
    maxHttpResponseMs: options.maxHttpResponseMs ?? 30_000,
    maxTunnelDurationMs:
      options.maxTunnelLifetimeMs ?? options.maxTunnelDurationMs ?? 45_000,
    maxTunnelBytes: options.maxTunnelBytes ?? 50 * 1024 * 1024,
    maxTotalTransferredBytes:
      options.maxTotalTransferredBytes ?? 100 * 1024 * 1024,
    maxRequests: options.maxRequests ?? 10_000,
    maxRequestsPerHostname: options.maxRequestsPerHostname ?? 5_000,
    allowOptions: options.allowOptions ?? true,
  };
  let transferredBytes = 0;
  const consumeBytes = (bytes: number) => {
    if (bytes === 0) return true;
    if (transferredBytes + bytes > resolvedOptions.maxTotalTransferredBytes)
      return false;
    if (resolvedOptions.accountBytes && !resolvedOptions.accountBytes(bytes))
      return false;
    transferredBytes += bytes;
    return true;
  };
  let requestCount = 0;
  const requestCountByHostname = new Map<string, number>();
  const consumeRequest = (hostname: string) => {
    const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
    const nextTotal = requestCount + 1;
    const nextForHostname =
      (requestCountByHostname.get(normalizedHostname) ?? 0) + 1;
    if (
      nextTotal > resolvedOptions.maxRequests ||
      nextForHostname > resolvedOptions.maxRequestsPerHostname
    ) {
      return false;
    }
    requestCount = nextTotal;
    requestCountByHostname.set(normalizedHostname, nextForHostname);
    return true;
  };
  const clientSockets = new Set<Socket>();
  const upstreamSockets = new Set<Socket>();
  let lifetimeTimer: NodeJS.Timeout | undefined;

  const server = http.createServer((request, response) => {
    void handleHttpRequest(
      request,
      response,
      resolvedOptions,
      consumeBytes,
      consumeRequest,
    ).catch(() => {
      endHttpError(response, 502, "Proxy request failed");
    });
  });

  server.maxConnections = resolvedOptions.maxConnections;
  server.headersTimeout = 5_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 1_000;

  server.on("connection", (socket) => {
    clientSockets.add(socket);
    socket.once("close", () => clientSockets.delete(socket));
  });
  server.on("connect", (request, socket, head) => {
    void handleConnect(
      request,
      socket,
      head,
      resolvedOptions,
      upstreamSockets,
      consumeBytes,
      consumeRequest,
    ).catch(() => endConnectError(socket, 502, "Bad Gateway"));
  });
  server.on("clientError", (_error, socket) => {
    if (!socket.destroyed) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Safe browser proxy did not bind to TCP");
  }

  if (resolvedOptions.maxLifetimeMs !== undefined) {
    if (
      !Number.isSafeInteger(resolvedOptions.maxLifetimeMs) ||
      resolvedOptions.maxLifetimeMs <= 0
    ) {
      server.close();
      throw new Error("Invalid proxy lifetime");
    }
    lifetimeTimer = setTimeout(() => {
      for (const socket of upstreamSockets) socket.destroy();
      for (const socket of clientSockets) socket.destroy();
      server.close();
    }, resolvedOptions.maxLifetimeMs);
    lifetimeTimer.unref();
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    async close(): Promise<void> {
      if (lifetimeTimer) clearTimeout(lifetimeTimer);
      for (const socket of upstreamSockets) {
        socket.destroy();
      }
      for (const socket of clientSockets) {
        socket.destroy();
      }

      if (!server.listening) {
        return;
      }

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
