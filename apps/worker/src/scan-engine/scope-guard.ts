export type ScopeDecision =
  | { allowed: true }
  | { allowed: false; reason: "invalid-url" | "outside-scope" };

function originOf(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Only explicitly listed origins are in scope. DNS aliases and subdomains grant nothing. */
export class ScopeGuard {
  private readonly origins: ReadonlySet<string>;

  constructor(canonicalUrl: string, additionalOrigins: readonly string[] = []) {
    const origins = [canonicalUrl, ...additionalOrigins].map(originOf);
    if (origins.some((origin) => origin === null)) {
      throw new Error("Invalid scan scope");
    }
    this.origins = new Set(origins as string[]);
  }

  allows(rawUrl: string): ScopeDecision {
    const origin = originOf(rawUrl);
    if (!origin) return { allowed: false, reason: "invalid-url" };
    return this.origins.has(origin)
      ? { allowed: true }
      : { allowed: false, reason: "outside-scope" };
  }

  allowsRedirect(from: string, to: string): ScopeDecision {
    const source = this.allows(from);
    return source.allowed ? this.allows(to) : source;
  }
}
