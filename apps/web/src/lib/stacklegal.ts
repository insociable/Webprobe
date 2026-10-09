import "server-only";

export const STACKLEGAL_PROVIDER_IDS = [
  "cloudflare",
  "stripe",
  "google-analytics",
  "plausible",
  "sentry",
  "posthog",
  "intercom",
  "hotjar",
  "vercel",
] as const;
export type StackLegalProviderId = (typeof STACKLEGAL_PROVIDER_IDS)[number];
export type StackLegalProvider = {
  id: StackLegalProviderId;
  name: string;
  legalName: string | null;
  category: string | null;
  purpose: string | null;
  location: string | null;
  transfer: string[];
  dpfStatus: string | null;
  officialUrl: string | null;
  officialUrlKind: string | null;
  pageUrl: string;
  lastVerified: string | null;
  verification: "verified" | "partial" | "unverified";
  missing: string[];
  aliases: string[];
};

const ORIGIN = "https://stacklegal.eu";
const CACHE_MS = 60 * 60 * 1000;
const MAX_BYTES = 64 * 1024;
const cache = new Map<
  string,
  { expires: number; provider: StackLegalProvider }
>();

export function isStackLegalProviderId(
  value: unknown,
): value is StackLegalProviderId {
  return (
    typeof value === "string" &&
    STACKLEGAL_PROVIDER_IDS.includes(value as StackLegalProviderId)
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, max = 4000): string | null {
  return typeof value === "string" && value.length <= max && value.trim()
    ? value
    : null;
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) &&
    value.length <= 32 &&
    value.every(
      (item) =>
        typeof item === "string" && item.length > 0 && item.length <= 160,
    )
    ? value
    : null;
}

function httpsUrl(value: unknown, stackLegalOnly = false): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    if (stackLegalOnly && url.hostname !== "stacklegal.eu") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseStackLegalProvider(
  json: unknown,
  expectedId: StackLegalProviderId,
): StackLegalProvider | null {
  const envelope = record(json);
  if (!envelope || envelope.apiVersion !== "1") return null;
  const source = record(envelope.provider);
  if (!source || source.id !== expectedId) return null;
  const name = boundedString(source.name, 160);
  const transfer = strings(source.transfer);
  const missing = strings(source.missing);
  const aliases = strings(source.aliases);
  const pageUrl = httpsUrl(source.pageUrl, true);
  if (!name || !transfer || !missing || !aliases || !pageUrl) return null;
  if (
    !["verified", "partial", "unverified"].includes(String(source.verification))
  )
    return null;
  const optional = [
    "legalName",
    "category",
    "purpose",
    "location",
    "dpfStatus",
    "officialUrlKind",
    "lastVerified",
  ] as const;
  for (const key of optional) {
    if (
      source[key] !== null &&
      source[key] !== undefined &&
      !boundedString(source[key])
    )
      return null;
  }
  if (
    source.officialUrl !== null &&
    source.officialUrl !== undefined &&
    !httpsUrl(source.officialUrl)
  )
    return null;
  if (
    source.lastVerified &&
    !/^\d{4}-\d{2}-\d{2}$/.test(String(source.lastVerified))
  )
    return null;
  return {
    id: expectedId,
    name,
    legalName: boundedString(source.legalName),
    category: boundedString(source.category),
    purpose: boundedString(source.purpose),
    location: boundedString(source.location),
    transfer,
    dpfStatus: boundedString(source.dpfStatus),
    officialUrl: httpsUrl(source.officialUrl),
    officialUrlKind: boundedString(source.officialUrlKind),
    pageUrl,
    lastVerified: boundedString(source.lastVerified),
    verification: source.verification as StackLegalProvider["verification"],
    missing,
    aliases,
  };
}

async function readLimited(response: Response): Promise<unknown> {
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > MAX_BYTES)
    throw new Error("response-too-large");
  if (!response.body) throw new Error("empty-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("response-too-large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function fetchStackLegalProvider(
  providerId: StackLegalProviderId,
  fetcher: typeof fetch = fetch,
): Promise<StackLegalProvider | null> {
  if (!isStackLegalProviderId(providerId)) return null;
  const cached = cache.get(providerId);
  if (cached && cached.expires > Date.now()) return cached.provider;
  try {
    const response = await fetcher(`${ORIGIN}/api/v1/providers/${providerId}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (
      !response.ok ||
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .includes("application/json")
    )
      return null;
    const provider = parseStackLegalProvider(
      await readLimited(response),
      providerId,
    );
    if (provider)
      cache.set(providerId, { expires: Date.now() + CACHE_MS, provider });
    return provider;
  } catch {
    return null;
  }
}
