import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { performance } from "node:perf_hooks";
import type { TLSSocket } from "node:tls";
import {
  assertPublicHttpUrl,
  defaultDnsResolver,
  type DnsResolver,
} from "@agency-saas/security";

export type ValidatedHttpTarget = Awaited<
  ReturnType<typeof assertPublicHttpUrl>
>;

export type ProbeTlsInfo = {
  protocol: string | null;
  cipher: string | null;
  validFrom: string | null;
  validTo: string | null;
};

export type ProbeRedirect = {
  statusCode: number;
  from: string;
  to: string;
};

export type SecurityHeaderObservation = {
  name: string;
  expected: boolean;
  present: boolean;
  value: string | null;
};
export type HttpProbeSuccess = {
  ok: true;
  finalUrl: string;
  statusCode: number;
  durationMs: number;
  redirects: ProbeRedirect[];
  headers: Record<string, string>;
  securityHeaders: SecurityHeaderObservation[];
  tls: ProbeTlsInfo | null;
};

export type HttpProbeFailure = {
  ok: false;
  targetUrl: string;
  redirects: ProbeRedirect[];
  error: {
    kind: "timeout" | "tls" | "network" | "redirect";
    code: string | null;
  };
};

export type HttpProbeResult = HttpProbeSuccess | HttpProbeFailure;

type RawProbeResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  durationMs: number;
  tls: ProbeTlsInfo | null;
};

export type HttpRequester = (
  target: ValidatedHttpTarget,
  timeoutMs: number,
) => Promise<RawProbeResponse>;
const reportHeaderNames = [
  "cache-control",
  "content-security-policy",
  "content-type",
  "permissions-policy",
  "referrer-policy",
  "server",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "x-powered-by",
] as const;

function firstHeaderValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | null {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function reportHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    reportHeaderNames.flatMap((name) => {
      const value = firstHeaderValue(headers, name);
      return value === null ? [] : [[name, value]];
    }),
  );
}
export function inspectSecurityHeaders(
  headers: IncomingHttpHeaders,
  protocol: "http:" | "https:",
): SecurityHeaderObservation[] {
  const names = [
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "x-frame-options",
    "strict-transport-security",
  ] as const;

  return names.map((name) => {
    const value = firstHeaderValue(headers, name);
    return {
      name,
      expected: name !== "strict-transport-security" || protocol === "https:",
      present: value !== null,
      value,
    };
  });
}

function tlsInfoFromSocket(socket: TLSSocket): ProbeTlsInfo {
  const certificate = socket.getPeerCertificate();
  return {
    protocol: socket.getProtocol(),
    cipher: socket.getCipher()?.name ?? null,
    validFrom: certificate.valid_from || null,
    validTo: certificate.valid_to || null,
  };
}
function pinnedLookup(target: ValidatedHttpTarget): LookupFunction {
  const address = target.addresses[0];
  if (!address) {
    throw new Error("Validated target has no pinned address");
  }
  const family = address.includes(":") ? 6 : 4;

  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

export const requestPinnedTarget: HttpRequester = async (target, timeoutMs) => {
  const transport = target.url.protocol === "https:" ? https : http;
  const startedAt = performance.now();

  return new Promise<RawProbeResponse>((resolve, reject) => {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const clearRequestTimeout = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };

    const request = transport.request(
      target.url,
      {
        method: "GET",
        lookup: pinnedLookup(target),
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "user-agent": "AgencyMonitor/0.1 (+site-maintenance-monitor)",
        },
        setHost: true,
      },
      (response) => {
        const tls =
          target.url.protocol === "https:"
            ? tlsInfoFromSocket(response.socket as TLSSocket)
            : null;

        const result: RawProbeResponse = {
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          durationMs: Math.round(performance.now() - startedAt),
          tls,
        };

        clearRequestTimeout();
        response.destroy();
        resolve(result);
      },
    );

    timeoutHandle = setTimeout(() => {
      const error = new Error("HTTP probe timed out") as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      request.destroy(error);
    }, timeoutMs);

    request.once("error", (error) => {
      clearRequestTimeout();
      reject(error);
    });
    request.end();
  });
};
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const tlsErrorCodes = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function networkFailure(
  targetUrl: string,
  redirects: ProbeRedirect[],
  error: unknown,
): HttpProbeFailure {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;

  const isTlsError =
    code !== null &&
    (tlsErrorCodes.has(code) ||
      code.startsWith("ERR_TLS_") ||
      code.includes("CERT") ||
      code.startsWith("UNABLE_TO_"));

  const kind =
    code === "ETIMEDOUT" ? "timeout" : isTlsError ? "tls" : "network";

  return {
    ok: false,
    targetUrl,
    redirects,
    error: { kind, code },
  };
}
export type HttpProbeOptions = {
  resolver?: DnsResolver;
  requester?: HttpRequester;
  timeoutMs?: number;
  maxRedirects?: number;
};

export async function probeHttpTarget(
  rawUrl: string,
  options: HttpProbeOptions = {},
): Promise<HttpProbeResult> {
  const resolver = options.resolver ?? defaultDnsResolver;
  const requester = options.requester ?? requestPinnedTarget;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const redirects: ProbeRedirect[] = [];
  let currentUrl = rawUrl;
  let totalDurationMs = 0;

  while (true) {
    const target = await assertPublicHttpUrl(currentUrl, resolver);

    let response: RawProbeResponse;
    try {
      response = await requester(target, timeoutMs);
    } catch (error) {
      return networkFailure(target.url.toString(), redirects, error);
    }

    totalDurationMs += response.durationMs;
    const location = firstHeaderValue(response.headers, "location");
    if (redirectStatuses.has(response.statusCode) && location) {
      if (redirects.length >= maxRedirects) {
        return {
          ok: false,
          targetUrl: target.url.toString(),
          redirects,
          error: { kind: "redirect", code: "TOO_MANY_REDIRECTS" },
        };
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, target.url);
      } catch {
        return {
          ok: false,
          targetUrl: target.url.toString(),
          redirects,
          error: { kind: "redirect", code: "INVALID_REDIRECT" },
        };
      }

      redirects.push({
        statusCode: response.statusCode,
        from: target.url.toString(),
        to: nextUrl.toString(),
      });
      currentUrl = nextUrl.toString();
      continue;
    }
    const protocol = target.url.protocol as "http:" | "https:";

    return {
      ok: true,
      finalUrl: target.url.toString(),
      statusCode: response.statusCode,
      durationMs: totalDurationMs,
      redirects,
      headers: reportHeaders(response.headers),
      securityHeaders: inspectSecurityHeaders(response.headers, protocol),
      tls: response.tls,
    };
  }
}
