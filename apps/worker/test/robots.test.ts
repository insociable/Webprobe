import { describe, expect, it } from "vitest";
import {
  isRobotsPathAllowed,
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
});
