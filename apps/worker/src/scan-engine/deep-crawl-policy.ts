import { classifyCrawlCandidate } from "../scanner-v2/crawl.js";
import {
  isRobotsPathAllowed,
  type RobotsPolicy,
} from "../scanner-v2/robots.js";
import type { AuthorizationDecision } from "./authorization.js";
import type { ScanProfile } from "./types.js";

/**
 * Offline policy ONLY. This module does not navigate, perform DNS or collect
 * pages. Callers must obtain consent from a trusted, persisted, site-scoped
 * authorization (never a queue payload or untrusted user JSON).
 */
export type DeepCrawlConsent = Readonly<{
  mode: "explicit-site-multipage";
  organizationId: string;
  siteId: string;
  canonicalUrl: string;
  maxPages: number;
  /** Exact, explicit paths or subtree prefixes ending in /. Never root /. */
  allowedPathPrefixes: readonly string[];
  grantedAt: Date;
  expiresAt: Date;
}>;

export type DeepCrawlGate =
  | { allowed: true; maxPages: number }
  | {
      allowed: false;
      reason:
        | "opt-in-required"
        | "deep-authorization-required"
        | "grant-identity-mismatch"
        | "invalid-consent"
        | "consent-expired"
        | "robots-unavailable";
    };

export type DeepCrawlRejection =
  | "malformed-url"
  | "non-http"
  | "credentials"
  | "external-origin"
  | "query-parameters"
  | "sensitive-path"
  | "path-not-consented"
  | "non-document"
  | "robots-disallowed"
  | "duplicate"
  | "page-budget";

export type DeepCrawlPlan = Readonly<{
  allowed: true;
  /** Ephemeral network targets: DO NOT persist or log these URL strings. */
  nextPageUrls: readonly string[];
  sampledLinkCount: number;
  sampleTruncated: boolean;
  consideredDistinctCount: number;
  rejectionCounts: Readonly<Partial<Record<DeepCrawlRejection, number>>>;
  maxTotalPages: number;
}>;

export type DeepCrawlPlanResult =
  | DeepCrawlPlan
  | Readonly<{
      allowed: false;
      reason: Extract<DeepCrawlGate, { allowed: false }>["reason"];
      nextPageUrls: readonly [];
    }>;

export const HARD_MAX_DEEP_CRAWL_PAGES = 5;
export const MAX_DEEP_CRAWL_LINK_SAMPLE = 100;
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

function validConsentPathPrefix(raw: string): boolean {
  return (
    typeof raw === "string" &&
    raw.startsWith("/") &&
    raw !== "/" &&
    raw.length <= MAX_CRAWL_PATH_LENGTH &&
    /^[a-zA-Z0-9_./~-]+$/.test(raw) &&
    !raw.includes("//") &&
    classifyPath(new URL(raw, "https://example.invalid/")) === null
  );
}

function pathWithinConsent(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) =>
      path === prefix ||
      (prefix.endsWith("/")
        ? path.startsWith(prefix)
        : path.startsWith(prefix + "/")),
  );
}

function sameUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    // Canonical verification is strict on origin, pathname and query.
    a.hash = "";
    b.hash = "";
    return a.toString() === b.toString();
  } catch {
    return false;
  }
}

export function verifyDeepCrawlGate(input: {
  canonicalUrl: string;
  organizationId: string;
  siteId: string;
  consent?: DeepCrawlConsent | null;
  authorization: AuthorizationDecision;
  profile: ScanProfile;
  robots: RobotsPolicy | null;
  now: Date;
}): DeepCrawlGate {
  const { consent, authorization, profile } = input;
  if (!consent || consent.mode !== "explicit-site-multipage") {
    return { allowed: false, reason: "opt-in-required" };
  }
  if (!authorization.allowed || authorization.level !== "deep") {
    return { allowed: false, reason: "deep-authorization-required" };
  }
  if (
    !authorization.grantIdentity ||
    !sameUrl(authorization.grantIdentity.canonicalUrl, input.canonicalUrl) ||
    !authorization.grantIdentity.ownershipGeneration ||
    !(authorization.grantIdentity.ownershipRevalidatedAt instanceof Date) ||
    !Number.isFinite(
      authorization.grantIdentity.ownershipRevalidatedAt.getTime(),
    ) ||
    authorization.grantIdentity.ownershipRevalidatedAt > input.now ||
    input.now.getTime() -
      authorization.grantIdentity.ownershipRevalidatedAt.getTime() >
      300_000
  ) {
    return { allowed: false, reason: "grant-identity-mismatch" };
  }
  if (
    profile.mode !== "verified_deep_audit" ||
    consent.siteId !== input.siteId ||
    consent.organizationId !== input.organizationId ||
    !sameUrl(consent.canonicalUrl, input.canonicalUrl) ||
    !Number.isSafeInteger(consent.maxPages) ||
    consent.maxPages < 2 ||
    consent.maxPages > HARD_MAX_DEEP_CRAWL_PAGES ||
    consent.maxPages > profile.budget.pages ||
    !Array.isArray(consent.allowedPathPrefixes) ||
    consent.allowedPathPrefixes.length < 1 ||
    consent.allowedPathPrefixes.length > 10 ||
    new Set(consent.allowedPathPrefixes).size !==
      consent.allowedPathPrefixes.length ||
    !consent.allowedPathPrefixes.every(validConsentPathPrefix) ||
    !(input.now instanceof Date) ||
    !Number.isFinite(input.now.getTime()) ||
    !(consent.grantedAt instanceof Date) ||
    !Number.isFinite(consent.grantedAt.getTime()) ||
    !(consent.expiresAt instanceof Date) ||
    !Number.isFinite(consent.expiresAt.getTime()) ||
    consent.grantedAt > input.now ||
    consent.expiresAt <= consent.grantedAt ||
    consent.expiresAt.getTime() - consent.grantedAt.getTime() > 86_400_000
  ) {
    return { allowed: false, reason: "invalid-consent" };
  }
  if (consent.expiresAt <= input.now) {
    return { allowed: false, reason: "consent-expired" };
  }
  if (!input.robots || input.robots.unavailableReason) {
    return { allowed: false, reason: "robots-unavailable" };
  }
  return { allowed: true, maxPages: consent.maxPages };
}

/**
 * No ambiguity is permitted for unattended GET navigations. Sensitive paths,
 * query strings, encoded separators, non-HTML targets and URLs that might
 * trigger state-changing routes are excluded; false negatives are intentional.
 */
function classifyPath(url: URL): DeepCrawlRejection | null {
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

function rejected(
  gate: Extract<DeepCrawlGate, { allowed: false }>,
): DeepCrawlPlanResult {
  return { allowed: false, reason: gate.reason, nextPageUrls: [] };
}

/**
 * Selects up to the remaining page budget from one document's observed links.
 * It deliberately does not fetch robots.txt: policy must be provided by an
 * independent, guarded transport, and unavailable policies deny everything.
 * visitedUrls must come from trusted scan state, not from a caller assertion.
 */
export function planDeepCrawlLinks(
  input: Parameters<typeof verifyDeepCrawlGate>[0] & {
    documentUrl: string;
    links: readonly string[];
    visitedUrls: readonly string[];
    linksTruncated?: boolean;
  },
): DeepCrawlPlanResult {
  const gate = verifyDeepCrawlGate(input);
  if (!gate.allowed) return rejected(gate);
  // A document address is an observed navigation outcome, not a trusted grant.
  // Check again even when a caller claims that the browser guard succeeded.
  let current: URL;
  try {
    current = new URL(input.documentUrl);
    const canonical = new URL(input.canonicalUrl);
    if (
      current.origin !== canonical.origin ||
      current.username ||
      current.password ||
      classifyPath(current)
    ) {
      return {
        allowed: false,
        reason: "grant-identity-mismatch",
        nextPageUrls: [],
      };
    }
  } catch {
    return {
      allowed: false,
      reason: "grant-identity-mismatch",
      nextPageUrls: [],
    };
  }
  const accepted = new Map<string, string>();
  const reasons: Partial<Record<DeepCrawlRejection, number>> = {};
  const reject = (reason: DeepCrawlRejection) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };
  const visited = new Set<string>();
  for (const raw of input.visitedUrls) {
    try {
      const url = new URL(raw);
      if (url.origin !== new URL(input.canonicalUrl).origin) {
        return {
          allowed: false,
          reason: "grant-identity-mismatch",
          nextPageUrls: [],
        };
      }
      url.hash = "";
      visited.add(url.toString());
    } catch {
      return {
        allowed: false,
        reason: "grant-identity-mismatch",
        nextPageUrls: [],
      };
    }
  }
  current.hash = "";
  visited.add(current.toString());
  const sample = input.links.slice(0, MAX_DEEP_CRAWL_LINK_SAMPLE);
  for (const raw of sample) {
    const outcome = classifyCrawlCandidate(
      raw,
      current.toString(),
      new URL(input.canonicalUrl).origin,
    );
    if (!outcome.accepted) {
      reject(outcome.reason);
      continue;
    }
    const url = new URL(outcome.candidate.navigationUrl);
    const unsafe = classifyPath(url);
    if (unsafe) {
      reject(unsafe);
      continue;
    }
    if (!pathWithinConsent(url.pathname, input.consent!.allowedPathPrefixes)) {
      reject("path-not-consented");
      continue;
    }
    url.hash = "";
    const target = url.toString();
    if (visited.has(target) || accepted.has(target)) {
      reject("duplicate");
      continue;
    }
    if (!isRobotsPathAllowed(input.robots!, url)) {
      reject("robots-disallowed");
      continue;
    }
    accepted.set(target, target);
  }
  const room = Math.max(0, gate.maxPages - visited.size);
  const candidates = [...accepted.keys()].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const nextPageUrls = candidates.slice(0, room);
  if (candidates.length > room) {
    reasons["page-budget"] = candidates.length - room;
  }
  return {
    allowed: true,
    nextPageUrls,
    sampledLinkCount: sample.length,
    sampleTruncated:
      input.linksTruncated === true ||
      input.links.length > MAX_DEEP_CRAWL_LINK_SAMPLE,
    consideredDistinctCount: accepted.size,
    rejectionCounts: reasons,
    maxTotalPages: gate.maxPages,
  };
}
