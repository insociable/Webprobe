import { createHash } from "node:crypto";

const sensitiveQueryParameter = /(?:^|[_-])(token|secret|password|pass|auth|code|session|signature|sig|key|access[_-]?token|id[_-]?token|state)(?:$|[_-])/i;

export type ObservedUrl = {
  /** URL safe to retain in scan output. Fragments are removed and sensitive values redacted. */
  displayUrl: string;
  /** Stable identity computed from the full fragment-free URL without retaining it. */
  urlKey: string;
  origin: string;
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

  for (const [name] of url.searchParams) {
    if (sensitiveQueryParameter.test(name)) {
      url.searchParams.set(name, "[redacted]");
    }
  }

  return {
    displayUrl: url.toString(),
    urlKey,
    origin: url.origin,
  };
}

export function safeDiagnosticPreview(value: string, maximumLength = 180): string {
  const withRedactedUrls = value.replace(
    /https?:\/\/[^\s"'<>]+/gi,
    (rawUrl) => observeUrl(rawUrl)?.displayUrl ?? "[invalid-url]",
  );

  return withRedactedUrls.slice(0, maximumLength);
}
