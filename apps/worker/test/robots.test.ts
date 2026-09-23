import { describe, expect, it } from "vitest";
import {
  isRobotsPathAllowed,
  MAX_ROBOTS_BYTES,
  MAX_ROBOTS_RULE_BYTES,
  MAX_ROBOTS_RULES,
  MAX_ROBOTS_WILDCARDS,
  parseRobotsTxt,
} from "../src/scanner-v2/robots.js";

describe("robots.txt policy", () => {
  it("prefers AgencyMonitor rules over wildcard groups", () => {
    const policy = parseRobotsTxt(
      [
        "User-agent: *",
        "Disallow: /private/",
        "User-agent: AgencyMonitor",
        "Disallow: /agency-only/",
      ].join("\n"),
    );

    expect(
      isRobotsPathAllowed(policy, new URL("https://example.com/private/a")),
    ).toBe(true);
    expect(
      isRobotsPathAllowed(policy, new URL("https://example.com/agency-only/a")),
    ).toBe(false);
  });

  it("uses the most specific matching rule and lets Allow win ties", () => {
    const policy = parseRobotsTxt(
      [
        "User-agent: *",
        "Disallow: /catalog/",
        "Allow: /catalog/public/",
        "Disallow: /same",
        "Allow: /same",
      ].join("\n"),
    );

    expect(
      isRobotsPathAllowed(
        policy,
        new URL("https://example.com/catalog/private"),
      ),
    ).toBe(false);
    expect(
      isRobotsPathAllowed(
        policy,
        new URL("https://example.com/catalog/public/item"),
      ),
    ).toBe(true);
    expect(
      isRobotsPathAllowed(policy, new URL("https://example.com/same")),
    ).toBe(true);
  });

  it("supports wildcards, end anchors, empty Disallow and bounded sitemaps", () => {
    const policy = parseRobotsTxt(
      [
        "User-agent: *",
        "Disallow:",
        "Disallow: /*?preview=$",
        "Sitemap: https://example.com/sitemap.xml",
      ].join("\n"),
    );

    expect(
      isRobotsPathAllowed(policy, new URL("https://example.com/page?preview=")),
    ).toBe(false);
    expect(
      isRobotsPathAllowed(
        policy,
        new URL("https://example.com/page?preview=1"),
      ),
    ).toBe(true);
    expect(policy.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("matches many wildcards without backtracking and bounds hostile rules", () => {
    const pattern = `/${"*a".repeat(24)}b`;
    const policy = parseRobotsTxt(`User-agent: *\nDisallow: ${pattern}`);
    expect(policy.unavailableReason).toBeUndefined();
    expect(
      isRobotsPathAllowed(
        policy,
        new URL(`https://example.com/${"a".repeat(256)}c`),
      ),
    ).toBe(true);
    expect(
      isRobotsPathAllowed(
        policy,
        new URL(`https://example.com/${"a".repeat(256)}b`),
      ),
    ).toBe(false);

    expect(
      parseRobotsTxt(
        `User-agent: *\nDisallow: /${"*".repeat(MAX_ROBOTS_WILDCARDS + 1)}`,
      ).unavailableReason,
    ).toBe("too-many-wildcards");
    expect(
      parseRobotsTxt(
        `User-agent: *\nDisallow: /${"a".repeat(MAX_ROBOTS_RULE_BYTES)}`,
      ).unavailableReason,
    ).toBe("rule-too-long");
    expect(
      parseRobotsTxt(
        `User-agent: *\n${"Disallow: /x\n".repeat(MAX_ROBOTS_RULES + 1)}`,
      ).unavailableReason,
    ).toBe("too-many-rules");
  });

  it("never treats an oversized or possibly truncated document as complete", () => {
    const prefix = "User-agent: *\nDisallow: /private\n";
    const below = prefix + "#".repeat(MAX_ROBOTS_BYTES - prefix.length - 1);
    const exact = `${below}#`;
    const above = `${exact}#`;
    const target = new URL("https://example.com/private");

    expect(Buffer.byteLength(below, "utf8")).toBe(MAX_ROBOTS_BYTES - 1);
    expect(isRobotsPathAllowed(parseRobotsTxt(below), target)).toBe(false);
    expect(parseRobotsTxt(exact).unavailableReason).toBe(
      "document-size-unconfirmed",
    );
    expect(
      isRobotsPathAllowed(
        parseRobotsTxt(exact, "AgencyMonitor", {
          completeAtByteLimit: true,
        }),
        target,
      ),
    ).toBe(false);
    expect(parseRobotsTxt(above).unavailableReason).toBe("document-too-large");

    const lateDisallow = `User-agent: *\n${"#".repeat(MAX_ROBOTS_BYTES)}\nDisallow: /private`;
    const unavailable = parseRobotsTxt(lateDisallow);
    expect(unavailable.unavailableReason).toBe("document-too-large");
    expect(isRobotsPathAllowed(unavailable, target)).toBe(false);
    expect(
      parseRobotsTxt(`User-agent: *\n${"é".repeat(MAX_ROBOTS_BYTES / 2)}`)
        .unavailableReason,
    ).toBe("document-too-large");
  });

  it("normalizes encoded unreserved octets and rejects ambiguous or invalid paths", () => {
    const policy = parseRobotsTxt(
      [
        "User-agent: *",
        "Disallow: /private",
        "Disallow: /private file",
        "Disallow: /items?draft=1$",
        "Disallow: /caf%C3%A9",
      ].join("\n"),
    );

    for (const path of [
      "/private",
      "/%70rivate",
      "/private%20file",
      "/private%2Fchild",
      "/%2Fprivate",
      "/bad%ZZpath",
      "/items?draft=%31",
      "/caf%C3%A9",
    ]) {
      expect(
        isRobotsPathAllowed(policy, new URL(`https://example.com${path}`)),
      ).toBe(false);
    }
    expect(
      isRobotsPathAllowed(policy, new URL("https://example.com/items?draft=2")),
    ).toBe(true);
    expect(
      isRobotsPathAllowed(policy, new URL("https://example.com/public%20file")),
    ).toBe(true);
    expect(
      isRobotsPathAllowed(
        parseRobotsTxt("User-agent: *\nDisallow: /%70rivate"),
        new URL("https://example.com/private"),
      ),
    ).toBe(false);
    expect(
      parseRobotsTxt("User-agent: *\nDisallow: /bad%ZZpath").unavailableReason,
    ).toBe("invalid-rule");
    expect(
      parseRobotsTxt("User-agent: *\nDisallow: /bad\\path").unavailableReason,
    ).toBe("invalid-rule");
  });
});
