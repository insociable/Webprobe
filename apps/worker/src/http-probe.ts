import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { X509Certificate } from "node:crypto";
import type { LookupFunction } from "node:net";
import { performance } from "node:perf_hooks";
import { checkServerIdentity, type TLSSocket } from "node:tls";
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
  certificate?: {
    subjectCn: string | null;
    subjectAltNames: string[];
    issuerCn: string | null;
    fingerprint256: string | null;
    signatureAlgorithm: string | null;
    keyType: string | null;
    keyBits: number | null;
    hostnameMatch: boolean | null;
    authorized: boolean;
    authorizationError: string | null;
    chain: Array<{
      subjectCn: string | null;
      issuerCn: string | null;
      fingerprint256: string | null;
      validFrom: string | null;
      validTo: string | null;
    }>;
  };
};

/** Cookie values are deliberately never copied into a scan observation. */
export type ProbeCookie = {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  domain: string | null;
  path: string | null;
  maxAge: string | null;
  expires: string | null;
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
  cookies?: ProbeCookie[];
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
  accountTransferredBytes?: (bytes: number) => void,
  signal?: AbortSignal,
) => Promise<RawProbeResponse>;
const reportHeaderNames = [
  "cache-control",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-type",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
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

function reportSafeUrl(input: URL): string {
  const safeUrl = new URL(input.toString());
  safeUrl.username = "";
  safeUrl.password = "";
  safeUrl.search = "";
  safeUrl.hash = "";
  return safeUrl.toString();
}

function reportHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    reportHeaderNames.flatMap((name) => {
      const value = firstHeaderValue(headers, name);
      return value === null ? [] : [[name, value.slice(0, 8192)]];
    }),
  );
}

export function observeCookies(headers: IncomingHttpHeaders): ProbeCookie[] {
  const source = headers["set-cookie"];
  const values = Array.isArray(source) ? source : source ? [source] : [];
  return values.slice(0, 40).flatMap((value) => {
    const [pair, ...attributes] = value.split(";");
    const separator = pair?.indexOf("=") ?? -1;
    if (separator < 1) return [];
    const name = pair!.slice(0, separator).trim().slice(0, 128);
    if (!name) return [];
    const fields = new Map<string, string>();
    for (const attribute of attributes) {
      const [key, ...rest] = attribute.trim().split("=");
      if (key)
        fields.set(key.toLowerCase(), rest.join("=").trim().slice(0, 256));
    }
    return [
      {
        name,
        secure: fields.has("secure"),
        httpOnly: fields.has("httponly"),
        sameSite: fields.get("samesite") ?? null,
        domain: fields.get("domain") ?? null,
        path: fields.get("path") ?? null,
        maxAge: fields.get("max-age") ?? null,
        expires: fields.get("expires") ?? null,
      },
    ];
  });
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

function tlsInfoFromSocket(socket: TLSSocket, hostname: string): ProbeTlsInfo {
  const certificate = socket.getPeerCertificate(true);
  const chain: NonNullable<ProbeTlsInfo["certificate"]>["chain"] = [];
  const seen = new Set<string>();
  let current = certificate;
  for (let index = 0; index < 5 && current?.raw; index += 1) {
    const fingerprint = current.fingerprint256 ?? "";
    if (seen.has(fingerprint)) break;
    seen.add(fingerprint);
    chain.push({
      subjectCn: current.subject?.CN?.slice(0, 256) ?? null,
      issuerCn: current.issuer?.CN?.slice(0, 256) ?? null,
      fingerprint256: fingerprint || null,
      validFrom: current.valid_from ?? null,
      validTo: current.valid_to ?? null,
    });
    current = current.issuerCertificate;
  }
  let keyType: string | null = null;
  let keyBits: number | null = null;
  try {
    const key = certificate.raw
      ? new X509Certificate(certificate.raw).publicKey
      : null;
    keyType = key?.asymmetricKeyType ?? null;
    keyBits =
      key?.asymmetricKeyDetails?.modulusLength ?? certificate.bits ?? null;
  } catch {
    // Metadata is optional; a parsing failure must not weaken TLS validation.
  }
  return {
    protocol: socket.getProtocol(),
    cipher: socket.getCipher()?.name ?? null,
    validFrom: certificate.valid_from || null,
    validTo: certificate.valid_to || null,
    certificate: {
      subjectCn: certificate.subject?.CN?.slice(0, 256) ?? null,
      subjectAltNames: (certificate.subjectaltname ?? "")
        .split(/,\s*/)
        .filter(Boolean)
        .slice(0, 32)
        .map((item) => item.slice(0, 256)),
      issuerCn: certificate.issuer?.CN?.slice(0, 256) ?? null,
      fingerprint256: certificate.fingerprint256 ?? null,
      signatureAlgorithm:
        (certificate as typeof certificate & { signatureAlgorithm?: string })
          .signatureAlgorithm ?? null,
      keyType,
      keyBits,
      hostnameMatch: certificate.raw
        ? checkServerIdentity(hostname, certificate) === undefined
        : null,
      authorized: socket.authorized,
      authorizationError: socket.authorizationError
        ? String(socket.authorizationError).slice(0, 256)
        : null,
      chain,
    },
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

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export const requestPinnedTarget: HttpRequester = async (
  target,
  timeoutMs,
  accountTransferredBytes,
  signal,
) => {
  const transport = target.url.protocol === "https:" ? https : http;
  const startedAt = performance.now();

  return new Promise<RawProbeResponse>((resolve, reject) => {
    let socket: import("node:net").Socket | undefined;
    let initialBytes = 0;
    let reported = false;
    const reportTransferredBytes = () => {
      if (reported) return;
      reported = true;
      accountTransferredBytes?.(
        socket
          ? Math.max(0, socket.bytesRead + socket.bytesWritten - initialBytes)
          : 0,
      );
    };
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
        ...(signal ? { signal } : {}),
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
            ? tlsInfoFromSocket(
                response.socket as TLSSocket,
                target.url.hostname,
              )
            : null;

        const result: RawProbeResponse = {
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          durationMs: Math.round(performance.now() - startedAt),
          tls,
        };

        clearRequestTimeout();
        try {
          reportTransferredBytes();
          response.destroy();
          resolve(result);
        } catch (error) {
          response.destroy();
          reject(error);
        }
      },
    );

    timeoutHandle = setTimeout(() => {
      const error = new Error("HTTP probe timed out") as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      request.destroy(error);
    }, timeoutMs);

    request.once("error", (error) => {
      clearRequestTimeout();
      try {
        reportTransferredBytes();
        reject(error);
      } catch (accountingError) {
        reject(accountingError);
      }
    });
    request.once("socket", (assignedSocket) => {
      socket = assignedSocket;
      initialBytes = assignedSocket.bytesRead + assignedSocket.bytesWritten;
    });
    request.end();
  });
};

export type BoundedTextFetchOptions = {
  resolver?: DnsResolver;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  userAgent?: string;
  allowRedirect?: (from: URL, to: URL) => boolean;
};

export type BoundedTextFetchResult = {
  statusCode: number;
  finalUrl: string;
  text: string;
  redirects: ProbeRedirect[];
};

type RawTextResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  text: string;
};

function codedError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

async function requestPinnedTextTarget(
  target: ValidatedHttpTarget,
  timeoutMs: number,
  maxBytes: number,
  userAgent: string,
): Promise<RawTextResponse> {
  const transport = target.url.protocol === "https:" ? https : http;

  return new Promise<RawTextResponse>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    const clearRequestTimeout = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
    const resolveOnce = (value: RawTextResponse) => {
      if (settled) return;
      settled = true;
      clearRequestTimeout();
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearRequestTimeout();
      reject(error);
    };

    const request = transport.request(
      target.url,
      {
        method: "GET",
        lookup: pinnedLookup(target),
        headers: {
          accept: "text/plain,*/*;q=0.1",
          "user-agent": userAgent,
        },
        setHost: true,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const headers = response.headers;
        if (
          redirectStatuses.has(statusCode) ||
          statusCode < 200 ||
          statusCode >= 300
        ) {
          response.destroy();
          resolveOnce({ statusCode, headers, text: "" });
          return;
        }

        const declaredLength = Number(
          firstHeaderValue(headers, "content-length"),
        );
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          response.destroy();
          rejectOnce(
            codedError(
              "ERR_RESPONSE_TOO_LARGE",
              "Response body exceeds configured limit",
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maxBytes) {
            response.destroy();
            rejectOnce(
              codedError(
                "ERR_RESPONSE_TOO_LARGE",
                "Response body exceeds configured limit",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => {
          resolveOnce({
            statusCode,
            headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.once("error", rejectOnce);
      },
    );

    timeoutHandle = setTimeout(() => {
      request.destroy(codedError("ETIMEDOUT", "HTTP text fetch timed out"));
    }, timeoutMs);
    request.once("error", rejectOnce);
    request.end();
  });
}

export async function fetchBoundedTextResource(
  rawUrl: string,
  options: BoundedTextFetchOptions = {},
): Promise<BoundedTextFetchResult> {
  const resolver = options.resolver ?? defaultDnsResolver;
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 5_000, 20_000));
  const maxRedirects = Math.max(0, Math.min(options.maxRedirects ?? 3, 5));
  const maxBytes = Math.max(1, Math.min(options.maxBytes ?? 65_536, 1_048_576));
  const userAgent = options.userAgent?.trim() || "AgencyMonitor/1.0";
  const allowRedirect =
    options.allowRedirect ??
    ((from: URL, to: URL) => from.origin === to.origin);
  const redirects: ProbeRedirect[] = [];
  const deadline = Date.now() + timeoutMs;
  let currentUrl = rawUrl;

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw codedError("ETIMEDOUT", "HTTP text fetch timed out");
    }
    const target = await assertPublicHttpUrl(currentUrl, resolver);
    const response = await requestPinnedTextTarget(
      target,
      remainingMs,
      maxBytes,
      userAgent,
    );
    const location = firstHeaderValue(response.headers, "location");
    if (redirectStatuses.has(response.statusCode) && location) {
      if (redirects.length >= maxRedirects) {
        throw codedError("ERR_TOO_MANY_REDIRECTS", "Too many redirects");
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, target.url);
      } catch {
        throw codedError("ERR_INVALID_REDIRECT", "Invalid redirect target");
      }
      if (!allowRedirect(target.url, nextUrl)) {
        throw codedError("ERR_UNSAFE_REDIRECT", "Redirect target not allowed");
      }

      redirects.push({
        statusCode: response.statusCode,
        from: reportSafeUrl(target.url),
        to: reportSafeUrl(nextUrl),
      });
      currentUrl = nextUrl.toString();
      continue;
    }

    return {
      statusCode: response.statusCode,
      finalUrl: target.url.toString(),
      text: response.text,
      redirects,
    };
  }
}

const tlsErrorCodes = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

export function networkFailure(
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
  signal?: AbortSignal;
  resolver?: DnsResolver;
  requester?: HttpRequester;
  timeoutMs?: number;
  maxRedirects?: number;
  beforeRequest?: (url: URL) => void | Promise<void>;
  beforeConnect?: (target: ValidatedHttpTarget) => number | Promise<number>;
  allowRedirect?: (from: URL, to: URL) => boolean;
  accountTransferredBytes?: (bytes: number) => void;
  requireTransferAccounting?: boolean;
  collectDeepMetadata?: boolean;
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
  const observedCookies: ProbeCookie[] = [];

  while (true) {
    if (options.signal?.aborted) throw new Error("HTTP probe aborted");
    // The guarded V3 caller checks authorization, scope and budget here,
    // before DNS resolution or any network request. V2 callers are unchanged.
    if (options.beforeRequest) await options.beforeRequest(new URL(currentUrl));
    const target = await assertPublicHttpUrl(currentUrl, resolver);
    if (options.signal?.aborted) throw new Error("HTTP probe aborted");
    const requestTimeoutMs =
      (await options.beforeConnect?.(target)) ?? timeoutMs;

    let response: RawProbeResponse;
    let accountingReported = false;
    let accountedBytes = 0;
    try {
      response = await requester(
        target,
        requestTimeoutMs,
        (bytes) => {
          accountingReported = true;
          accountedBytes += bytes;
          options.accountTransferredBytes?.(bytes);
        },
        options.signal,
      );
      if (options.requireTransferAccounting) {
        if (!accountingReported) {
          throw new Error("HTTP requester omitted transfer accounting");
        }
        if (accountedBytes <= 0) {
          throw new Error("HTTP requester reported no transferred bytes");
        }
      }
    } catch (error) {
      if (options.requireTransferAccounting) throw error;
      return networkFailure(reportSafeUrl(target.url), redirects, error);
    }

    totalDurationMs += response.durationMs;
    if (options.collectDeepMetadata && observedCookies.length < 120) {
      observedCookies.push(
        ...observeCookies(response.headers).slice(
          0,
          120 - observedCookies.length,
        ),
      );
    }
    const location = firstHeaderValue(response.headers, "location");
    if (redirectStatuses.has(response.statusCode) && location) {
      if (redirects.length >= maxRedirects) {
        return {
          ok: false,
          targetUrl: reportSafeUrl(target.url),
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
          targetUrl: reportSafeUrl(target.url),
          redirects,
          error: { kind: "redirect", code: "INVALID_REDIRECT" },
        };
      }

      if (
        options.allowRedirect &&
        !options.allowRedirect(target.url, nextUrl)
      ) {
        return {
          ok: false,
          targetUrl: reportSafeUrl(target.url),
          redirects,
          error: { kind: "redirect", code: "REDIRECT_NOT_ALLOWED" },
        };
      }

      redirects.push({
        statusCode: response.statusCode,
        from: reportSafeUrl(target.url),
        to: reportSafeUrl(nextUrl),
      });
      currentUrl = nextUrl.toString();
      continue;
    }
    const protocol = target.url.protocol as "http:" | "https:";

    return {
      ok: true,
      finalUrl: reportSafeUrl(target.url),
      statusCode: response.statusCode,
      durationMs: totalDurationMs,
      redirects,
      headers: reportHeaders(response.headers),
      securityHeaders: inspectSecurityHeaders(response.headers, protocol),
      tls: response.tls,
      ...(options.collectDeepMetadata ? { cookies: observedCookies } : {}),
    };
  }
}
