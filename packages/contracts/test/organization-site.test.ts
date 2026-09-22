import { describe, expect, it } from "vitest";
import {
  OrganizationCreateSchema,
  SiteCreateSchema,
  normalizeCanonicalSiteUrl,
} from "../src/organization-site.js";

describe("OrganizationCreateSchema", () => {
  it("trims and collapses whitespace", () => {
    expect(
      OrganizationCreateSchema.parse({ name: "  Agence   Nord  " }),
    ).toEqual({ name: "Agence Nord" });
  });

  it("rejects empty names", () => {
    expect(() => OrganizationCreateSchema.parse({ name: "   " })).toThrow();
  });
});

describe("normalizeCanonicalSiteUrl", () => {
  it.each([
    ["HTTPS://Example.COM", "https://example.com/"],
    ["https://example.com/path/", "https://example.com/path"],
    ["http://example.com:80/", "http://example.com/"],
    ["https://example.com:443/", "https://example.com/"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeCanonicalSiteUrl(input)).toBe(expected);
  });
  it.each([
    "ftp://example.com",
    "https://user:pass@example.com",
    "https://example.com:8443",
    "https://example.com/path?token=secret",
    "https://example.com/path#fragment",
  ])("rejects unsafe or unstable URL %s", (input) => {
    expect(() => normalizeCanonicalSiteUrl(input)).toThrow();
  });
});

describe("SiteCreateSchema", () => {
  it("normalizes both name and canonical URL", () => {
    expect(
      SiteCreateSchema.parse({
        name: "  Site   vitrine ",
        canonicalUrl: "HTTPS://Example.COM/",
      }),
    ).toEqual({
      name: "Site vitrine",
      canonicalUrl: "https://example.com/",
    });
  });
});
