type UnknownRecord = Record<string, unknown>;

export type ReportTechnicalDetails = {
  http: {
    statusCode: number | null;
    finalUrl: string | null;
    durationMs: number | null;
    headers: Array<{ name: string; value: string }>;
    tls: {
      protocol: string | null;
      cipher: string | null;
      validFrom: string | null;
      validTo: string | null;
    } | null;
  };
};

const allowedHeaderNames = [
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

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sanitizeReportUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    const withoutFragment = value.split("#", 1)[0] ?? "";
    return (withoutFragment.split("?", 1)[0] ?? "").slice(0, 2048);
  }
}

export function sanitizeReportHeaderValue(value: string): string {
  const withoutControlCharacters = value.replace(/[\r\n\0]/g, " ");
  const sanitizedUrls = withoutControlCharacters.replace(
    /https?:\/\/[^\s;,"'<>]+/gi,
    (url) => sanitizeReportUrl(url),
  );
  return sanitizedUrls.slice(0, 4096);
}

export function getSafeReportTechnicalDetails(
  summary: unknown,
): ReportTechnicalDetails | null {
  const root = record(summary);
  const http = record(root?.http);
  if (!http) return null;

  const rawHeaders = record(http.headers);
  const headers = allowedHeaderNames.flatMap((name) => {
    const value = stringValue(rawHeaders?.[name]);
    return value ? [{ name, value: sanitizeReportHeaderValue(value) }] : [];
  });

  const tls = record(http.tls);
  const tlsDetails = tls
    ? {
        protocol: stringValue(tls.protocol),
        cipher: stringValue(tls.cipher),
        validFrom: stringValue(tls.validFrom),
        validTo: stringValue(tls.validTo),
      }
    : null;

  return {
    http: {
      statusCode: finiteNumber(http.statusCode),
      finalUrl: stringValue(http.finalUrl)
        ? sanitizeReportUrl(stringValue(http.finalUrl)!)
        : null,
      durationMs: finiteNumber(http.durationMs),
      headers,
      tls: tlsDetails,
    },
  };
}
