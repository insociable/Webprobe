import { createHash } from "node:crypto";

export type ObservedUrl = {
  /** URL safe to retain in scan output. Query strings and fragments are removed. */
  displayUrl: string;
  /** Stable identity computed from the full fragment-free URL without retaining it. */
  urlKey: string;
  origin: string;
  hasQuery: boolean;
};

function fragmentFreeUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function createUrlKey(rawUrl: string): string | null {
  const url = fragmentFreeUrl(rawUrl);
  if (!url) {
    return null;
  }

  return createHash("sha256").update(url.toString()).digest("hex");
}

export function isAllowedCanonicalOriginShift(
  initialRawUrl: string,
  finalRawUrl: string,
): boolean {
  let initial: URL;
  let final: URL;
  try {
    initial = new URL(initialRawUrl);
    final = new URL(finalRawUrl);
  } catch {
    return false;
  }

  if (
    !["http:", "https:"].includes(initial.protocol) ||
    !["http:", "https:"].includes(final.protocol)
  ) {
    return false;
  }

  const normalizeHost = (hostname: string) =>
    hostname.toLowerCase().replace(/\.$/, "");
  const initialHost = normalizeHost(initial.hostname);
  const finalHost = normalizeHost(final.hostname);
  const stripWww = (hostname: string) =>
    hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  const sameHostFamily =
    initialHost === finalHost ||
    (stripWww(initialHost) === stripWww(finalHost) &&
      (initialHost.startsWith("www.") || finalHost.startsWith("www.")));
  const compatiblePort =
    initial.port === final.port || (!initial.port && !final.port);

  return sameHostFamily && compatiblePort;
}

export function observeUrl(rawUrl: string): ObservedUrl | null {
  const url = fragmentFreeUrl(rawUrl);
  const urlKey = createUrlKey(rawUrl);
  if (!url || !urlKey) {
    return null;
  }

  const hasQuery = url.search.length > 0;
  url.username = "";
  url.password = "";
  url.search = "";

  return {
    displayUrl: url.toString(),
    urlKey,
    origin: url.origin,
    hasQuery,
  };
}
