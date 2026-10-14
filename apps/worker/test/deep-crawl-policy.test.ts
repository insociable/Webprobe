import { describe, expect, it } from "vitest";
import type { AuthorizationDecision } from "../src/scan-engine/authorization.js";
import {
  HARD_MAX_DEEP_CRAWL_PAGES,
  planDeepCrawlLinks,
  verifyDeepCrawlGate,
  type DeepCrawlConsent,
} from "../src/scan-engine/deep-crawl-policy.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { parseRobotsTxt } from "../src/scanner-v2/robots.js";

const now = new Date("2026-10-14T15:00:00Z");
const siteId = "site-1";
const organizationId = "org-1";
const canonicalUrl = "https://example.com/";
const identity = {
  canonicalUrl,
  siteVerifiedAt: now,
  ownershipGeneration: "generation-1",
  ownershipTokenHash: "a".repeat(64),
  ownershipVerifiedAt: now,
  ownershipRevalidatedAt: now,
};
const deepAuthorization: AuthorizationDecision = {
  allowed: true,
  level: "deep",
  grantIdentity: identity,
};
const consent: DeepCrawlConsent = {
  mode: "explicit-site-multipage",
  organizationId,
  siteId,
  canonicalUrl,
  maxPages: 3,
  allowedPathPrefixes: ["/blog/", "/news/", "/contact", "/public", "/about"],
  grantedAt: new Date("2026-10-14T13:00:00Z"),
  expiresAt: new Date("2026-10-14T17:00:00Z"),
};
const robots = parseRobotsTxt(
  "User-agent: *\nDisallow: /private/\nDisallow: /secret/\n",
);
const common = {
  canonicalUrl,
  organizationId,
  siteId,
  consent,
  authorization: deepAuthorization,
  profile: resolveScanProfile("verified_deep_audit"),
  robots,
  now,
};

describe("Deep multi-page consent gate: fail-closed, offline", () => {
  it("remains disabled unless an independent site-scoped opt-in exists", () => {
    expect(verifyDeepCrawlGate({ ...common, consent: null })).toMatchObject({
      allowed: false,
      reason: "opt-in-required",
    });
    expect(
      planDeepCrawlLinks({
        ...common,
        consent: null,
        documentUrl: canonicalUrl,
        visitedUrls: [],
        links: ["/public"],
      }),
    ).toEqual({ allowed: false, reason: "opt-in-required", nextPageUrls: [] });
  });

  it("requires a matching and authorized Deep grant", () => {
    expect(
      verifyDeepCrawlGate({
        ...common,
        authorization: { allowed: false, reason: "deep-grant-expired" },
      }),
    ).toMatchObject({ allowed: false, reason: "deep-authorization-required" });
    expect(
      verifyDeepCrawlGate({
        ...common,
        authorization: {
          allowed: true,
          level: "deep",
          grantIdentity: {
            ...identity,
            canonicalUrl: "https://other.example/",
          },
        },
      }),
    ).toMatchObject({ allowed: false, reason: "grant-identity-mismatch" });
    expect(
      verifyDeepCrawlGate({
        ...common,
        authorization: { allowed: true, level: "verified" },
      }),
    ).toMatchObject({ allowed: false });
    expect(
      verifyDeepCrawlGate({
        ...common,
        authorization: {
          allowed: true,
          level: "deep",
          grantIdentity: {
            ...identity,
            ownershipRevalidatedAt: new Date("2026-10-14T14:50:00Z"),
          },
        },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "grant-identity-mismatch",
    });
  });

  it("rejects wrong site, organization, canonical URL or excessive scope", () => {
    const unsafe: Array<Partial<DeepCrawlConsent>> = [
      { siteId: "site-2" },
      { organizationId: "org-2" },
      { canonicalUrl: "https://other.example/" },
      { maxPages: 1 },
      { maxPages: 6 },
      { maxPages: 40 },
      { maxPages: 2.4 },
      { allowedPathPrefixes: [] },
      { allowedPathPrefixes: ["/"] },
      { allowedPathPrefixes: ["/blog/", "/blog/"] },
      { allowedPathPrefixes: ["/public?token=secret"] },
      { allowedPathPrefixes: ["/blog/%252fadmin"] },
      { allowedPathPrefixes: ["/admin/"] },
      {
        expiresAt: new Date("2026-10-16T13:00:00Z"),
      },
      { allowedPathPrefixes: ["/path/" + "a".repeat(260)] },
      {
        allowedPathPrefixes: Array.from({ length: 11 }, (_, n) => "/blog/" + n),
      },
    ];
    for (const item of unsafe) {
      expect(
        verifyDeepCrawlGate({ ...common, consent: { ...consent, ...item } }),
      ).toMatchObject({ allowed: false, reason: "invalid-consent" });
    }
    expect(HARD_MAX_DEEP_CRAWL_PAGES).toBe(5);
  });

  it("requires current dates and disallows expired opt-ins", () => {
    expect(
      verifyDeepCrawlGate({
        ...common,
        consent: { ...consent, expiresAt: new Date("2026-10-14T14:59:59Z") },
      }),
    ).toMatchObject({ allowed: false, reason: "consent-expired" });
    expect(
      verifyDeepCrawlGate({
        ...common,
        consent: { ...consent, grantedAt: new Date("2026-10-15T00:00:00Z") },
      }),
    ).toMatchObject({ allowed: false, reason: "invalid-consent" });
    expect(
      verifyDeepCrawlGate({
        ...common,
        consent: { ...consent, expiresAt: new Date("bad") },
      }),
    ).toMatchObject({ allowed: false, reason: "invalid-consent" });
  });

  it("fails closed on missing or truncated/unparseable robots.txt", () => {
    for (const policy of [
      null,
      parseRobotsTxt("User-agent: *\nDisallow: /\n".repeat(1100)),
    ]) {
      expect(verifyDeepCrawlGate({ ...common, robots: policy })).toMatchObject({
        allowed: false,
        reason: "robots-unavailable",
      });
    }
  });
});

describe("Deep crawl planner: bounded destination selection without network I/O", () => {
  it("selects only consented paths, with stable sorting, dedup and page cap", () => {
    const result = planDeepCrawlLinks({
      ...common,
      documentUrl: canonicalUrl,
      visitedUrls: [canonicalUrl],
      links: [
        "/news/",
        "/blog/",
        "/blog/#fragment",
        "/blog/?session=secret",
        "/private/document",
        "/admin/",
        "/logout",
        "/api/stats",
        "/assets/logo.png",
        "/app.js",
        "/download.pdf",
        "https://cdn.example.net/landing",
        "https://example.com:8443/elsewhere",
        "https://user:pass@example.com/story",
        "javascript:alert(1)",
        "/posts/a%2Fb",
        "/session/abc",
        "/0123456789abcdef0123456789abcdef",
        "/contact",
      ],
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("Unexpected gate denial");
    expect(result.nextPageUrls).toEqual([
      "https://example.com/blog/",
      "https://example.com/contact",
    ]);
    expect(result.sampledLinkCount).toBe(19);
    expect(result.consideredDistinctCount).toBe(3);
    expect(result.rejectionCounts).toMatchObject({
      duplicate: 1,
      "page-budget": 1,
      "query-parameters": 1,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("user:pass");
  });

  it("returns no further page when visited budget already consumed", () => {
    const result = planDeepCrawlLinks({
      ...common,
      documentUrl: "https://example.com/blog/",
      visitedUrls: [
        canonicalUrl,
        "https://example.com/blog/",
        "https://example.com/contact",
      ],
      links: ["/news/", "/about"],
    });
    expect(result).toMatchObject({
      allowed: true,
      nextPageUrls: [],
      rejectionCounts: { "page-budget": 2 },
    });
  });

  it("does not treat a URL with query, credentials or escaped scope as a trusted page", () => {
    for (const documentUrl of [
      "https://external.example/",
      "https://example.com/logout",
      "https://example.com/page?token=secret",
      "https://example.com:8443/page",
      "garbage-document",
      "https://user:pass@example.com/",
      "https://example.com/blog/%2fadmin",
    ]) {
      expect(
        planDeepCrawlLinks({
          ...common,
          documentUrl,
          visitedUrls: [canonicalUrl],
          links: ["/about"],
        }),
      ).toMatchObject({
        allowed: false,
        reason: "grant-identity-mismatch",
        nextPageUrls: [],
      });
    }
  });

  it("enforces robots Disallow and never exposes blocked URLs in its evidence", () => {
    const local = {
      ...common,
      consent: {
        ...consent,
        allowedPathPrefixes: [...consent.allowedPathPrefixes, "/private/"],
      },
    };
    const result = planDeepCrawlLinks({
      ...local,
      documentUrl: canonicalUrl,
      visitedUrls: [],
      links: ["/private/index", "/public"],
    });
    expect(result).toMatchObject({
      allowed: true,
      nextPageUrls: ["https://example.com/public"],
      rejectionCounts: { "robots-disallowed": 1 },
    });
    expect(JSON.stringify(result)).not.toContain("/private/");
  });

  it("honors the sample limit without logging sensitive link strings", () => {
    const sensitive = Array.from(
      { length: 120 },
      (_, index) => "/blog/?token=confidential-" + index,
    );
    const result = planDeepCrawlLinks({
      ...common,
      documentUrl: canonicalUrl,
      visitedUrls: [],
      links: [...sensitive, "/public"],
    });
    expect(result).toMatchObject({
      allowed: true,
      nextPageUrls: [],
      sampledLinkCount: 100,
      sampleTruncated: true,
      rejectionCounts: { "query-parameters": 100 },
    });
    expect(JSON.stringify(result)).not.toContain("confidential");
  });

  it("rejects state-changing-looking routes even if user mistakenly consented to their parent", () => {
    const result = planDeepCrawlLinks({
      ...common,
      consent: {
        ...consent,
        allowedPathPrefixes: ["/blog/", "/about", "/public", "/contact"],
      },
      documentUrl: canonicalUrl,
      visitedUrls: [],
      links: [
        "/save",
        "/delete-account",
        "/reset-password",
        "/account",
        "/profile",
        "/admin",
        "/wp-admin",
        "/blog/%252Fadmin",
        "/blog/hello%20world",
        "/blog/.secret",
        "/blog/wp-login.php",
        "/blog/robots.txt",
        "/blog/valid-article",
      ],
    });
    expect(result).toMatchObject({
      allowed: true,
      nextPageUrls: ["https://example.com/blog/valid-article"],
    });
  });

  it("does not confuse a consented prefix with a neighboring path", () => {
    const result = planDeepCrawlLinks({
      ...common,
      documentUrl: canonicalUrl,
      visitedUrls: [],
      links: ["/blogs/", "/blog/one", "/blog/one/article", "/about-us"],
    });
    expect(result).toMatchObject({
      allowed: true,
      nextPageUrls: [
        "https://example.com/blog/one",
        "https://example.com/blog/one/article",
      ],
      rejectionCounts: { "path-not-consented": 2 },
    });
  });
});
