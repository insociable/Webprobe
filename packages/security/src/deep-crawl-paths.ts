/** Shared allowlist validation: identical restrictions in API and future worker. */
const MAX_CRAWL_PATH_LENGTH = 256;
const MAX_PATH_SEGMENT_LENGTH = 64;
const SENSITIVE_SEGMENTS = new Set([
  "account",
  "admin",
  "api",
  "auth",
  "billing",
  "cart",
  "checkout",
  "confirm",
  "dashboard",
  "delete",
  "destroy",
  "edit",
  "email",
  "export",
  "forgot-password",
  "invite",
  "invoices",
  "login",
  "logout",
  "manage",
  "oauth",
  "order",
  "orders",
  "password",
  "payment",
  "payments",
  "profile",
  "publish",
  "register",
  "remove",
  "retry",
  "reset",
  "restart",
  "save",
  "send",
  "session",
  "sessions",
  "settings",
  "sign-in",
  "sign-out",
  "signin",
  "signout",
  "start",
  "stop",
  "submit",
  "subscribe",
  "token",
  "trigger",
  "unsubscribe",
  "update",
  "upload",
  "user",
  "users",
  "wp-admin",
  "wp-json",
  "wp-login.php",
]);

export function validDeepCrawlConsentPrefix(raw: string): boolean {
  return (
    typeof raw === "string" &&
    raw.startsWith("/") &&
    raw !== "/" &&
    raw.length <= MAX_CRAWL_PATH_LENGTH &&
    /^[a-zA-Z0-9_./~-]+$/.test(raw) &&
    !raw.includes("//") &&
    classifyDeepCrawlPath(new URL(raw, "https://example.invalid/")) === null
  );
}

/**
 * No ambiguity is permitted for unattended GET navigations. Sensitive paths,
 * query strings, encoded separators, non-HTML targets and URLs that might
 * trigger state-changing routes are excluded; false negatives are intentional.
 */
export function classifyDeepCrawlPath(
  url: URL,
): "query-parameters" | "sensitive-path" | "non-document" | null {
  if (url.search) return "query-parameters";
  const path = url.pathname;
  if (
    path.length > MAX_CRAWL_PATH_LENGTH ||
    !/^[a-zA-Z0-9_./~-]*$/.test(path) ||
    path.includes("//")
  ) {
    return "sensitive-path";
  }
  const segments = path.split("/").filter(Boolean);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (
      segment.length > MAX_PATH_SEGMENT_LENGTH ||
      segment.startsWith(".") ||
      SENSITIVE_SEGMENTS.has(lower) ||
      /^(?:admin|auth|delete|edit|login|logout|reset|token|user)[-_.]/.test(
        lower,
      ) ||
      /(?:^|[-_.])(?:token|secret|password|key)(?:$|[-_.])/.test(lower) ||
      /^[0-9a-f]{24,}$/i.test(segment) ||
      /^[a-z0-9_-]{32,}$/i.test(segment)
    ) {
      return "sensitive-path";
    }
  }
  const tail = segments.at(-1) ?? "";
  if (tail.includes(".") && !/\.html?$/i.test(tail)) return "non-document";
  return null;
}
