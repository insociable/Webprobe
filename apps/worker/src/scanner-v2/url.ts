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

export function observeUrl(rawUrl: string): ObservedUrl | null {
  const url = fragmentFreeUrl(rawUrl);
  const urlKey = createUrlKey(rawUrl);
  if (!url || !urlKey) {
    return null;
  }

  const hasQuery = url.search.length > 0;
  url.search = "";

  return {
    displayUrl: url.toString(),
    urlKey,
    origin: url.origin,
    hasQuery,
  };
}
