import {
  classifyDeepCrawlPath,
  validDeepCrawlConsentPrefix,
} from "@agency-saas/security";
import type { BrowserRequestPolicyInput } from "../browser-runtime.js";

/**
 * Fail-closed, in-memory *navigation* gate for a future explicitly opted-in
 * Deep crawl. It does not start any navigation or extend the current scanner.
 *
 * Every page.goto must be deliberately armed by the server. A redirect to a
 * different URL, a JS/meta navigation and any iframe navigation are rejected.
 * The HTTP(S) proxy cannot inspect paths inside a TLS CONNECT tunnel: the
 * browser's route guard is mandatory as well as the current proxy/SSRF checks.
 */
export function createDeepNavigationGuard(input: {
  canonicalUrl: string;
  allowedPathPrefixes: readonly string[];
  maxPages: number;
  /** Runs a database-time read of lease + consent + both DNS generations. */
  assertCurrent: () => Promise<void>;
}): {
  authorizeRequest(request: BrowserRequestPolicyInput): Promise<boolean>;
  assertCurrent(): Promise<void>;
  withNavigation<T>(url: string, navigate: () => Promise<T>): Promise<T>;
} {
  if (
    !Number.isSafeInteger(input.maxPages) ||
    input.maxPages < 2 ||
    input.maxPages > 5 ||
    input.allowedPathPrefixes.length < 1 ||
    input.allowedPathPrefixes.length > 10 ||
    new Set(input.allowedPathPrefixes).size !==
      input.allowedPathPrefixes.length ||
    !input.allowedPathPrefixes.every(validDeepCrawlConsentPrefix)
  ) {
    throw new Error("Unsafe Deep crawl navigation authorization");
  }

  let root: URL;
  try {
    root = new URL(input.canonicalUrl);
    if (
      !["https:", "http:"].includes(root.protocol) ||
      root.username ||
      root.password ||
      root.search ||
      root.hash ||
      classifyDeepCrawlPath(root)
    ) {
      throw new Error("Unsafe canonical URL");
    }
  } catch {
    throw new Error("Unsafe Deep crawl canonical URL");
  }

  const normalized = (raw: string): string | null => {
    try {
      const url = new URL(raw);
      if (
        url.origin !== root.origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        classifyDeepCrawlPath(url)
      ) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  };

  const pathAllowed = (url: URL) =>
    pathPrefixes.some(
      (prefix) =>
        url.pathname === prefix ||
        (prefix.endsWith("/")
          ? url.pathname.startsWith(prefix)
          : url.pathname.startsWith(prefix + "/")),
    );

  // Take a defensive copy: a caller cannot extend scope by mutating a list
  // that was validated earlier. The DB revision is checked independently.
  const pathPrefixes = Object.freeze([...input.allowedPathPrefixes]);
  const maxPages = input.maxPages;
  const initial = root.toString();
  let armed: string | null = null;
  let attemptedCount = 0;
  let inProgress = false;

  return {
    assertCurrent: input.assertCurrent,
    async authorizeRequest(request): Promise<boolean> {
      // Do not relax any existing subresource checks in browser-runtime or the proxy.
      if (!request.isNavigationRequest) return true;
      if (
        !inProgress ||
        !request.isMainFrameNavigation ||
        request.resourceType !== "document" ||
        !["GET", "HEAD"].includes(request.method.toUpperCase()) ||
        !armed
      ) {
        return false;
      }
      const target = normalized(request.url);
      // Redirects are allowed only if their final URL is identical to the
      // explicitly armed destination. Fail closed even for same-origin changes.
      if (target !== armed) return false;
      if (
        request.redirectedFromUrl !== null &&
        normalized(request.redirectedFromUrl) !== armed
      ) {
        return false;
      }
      try {
        await input.assertCurrent();
        return true;
      } catch {
        return false;
      }
    },

    async withNavigation<T>(
      rawUrl: string,
      navigate: () => Promise<T>,
    ): Promise<T> {
      const target = normalized(rawUrl);
      if (
        inProgress ||
        target === null ||
        attemptedCount >= maxPages ||
        (target !== initial && !pathAllowed(new URL(target)))
      ) {
        throw new Error("Deep navigation target not authorized");
      }

      // Guard against revoked consent before queuing even the first navigation.
      await input.assertCurrent();
      inProgress = true;
      armed = target;
      attemptedCount += 1;
      try {
        const result = await navigate();
        return result;
      } finally {
        armed = null;
        inProgress = false;
      }
    },
  };
}
