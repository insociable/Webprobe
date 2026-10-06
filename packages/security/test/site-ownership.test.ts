import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalSiteOrigin,
  classifyOwnershipDnsFailure,
  getSiteOwnershipProofTtlMs,
  hasCurrentSiteOwnershipProof,
  matchesSiteOwnershipToken,
  siteOwnershipRecordName,
  type SiteOwnershipProof,
} from "../src/index.js";

const now = new Date("2026-10-06T12:00:00.000Z");
const token = "agency-monitor=sample-token";
const hash = createHash("sha256").update(token).digest("hex");

function proof(
  overrides: Partial<SiteOwnershipProof> = {},
): SiteOwnershipProof {
  return {
    canonicalUrl: "https://example.com/path",
    status: "active",
    verifiedAt: new Date("2026-10-01T00:00:00.000Z"),
    ownershipTokenHash: hash,
    ownershipRecordName: "_agency-monitor.example.com",
    ownershipOrigin: "https://example.com",
    ownershipGeneration: "generation-1",
    ownershipVerifiedAt: new Date("2026-10-01T00:00:00.000Z"),
    ownershipRevalidatedAt: new Date("2026-10-05T00:00:00.000Z"),
    ownershipExpiresAt: new Date("2026-11-05T00:00:00.000Z"),
    ownershipInvalidatedAt: null,
    ...overrides,
  };
}

describe("durable DNS ownership proof", () => {
  it("binds the TXT name to the canonical hostname and origin", () => {
    expect(canonicalSiteOrigin("https://example.com/path")).toBe(
      "https://example.com",
    );
    expect(siteOwnershipRecordName("https://example.com/path")).toBe(
      "_agency-monitor.example.com",
    );
    expect(hasCurrentSiteOwnershipProof(proof(), now)).toBe(true);
    expect(
      hasCurrentSiteOwnershipProof(
        proof({ canonicalUrl: "https://other.example.com" }),
        now,
      ),
    ).toBe(false);
    expect(
      hasCurrentSiteOwnershipProof(
        proof({ canonicalUrl: "http://example.com" }),
        now,
      ),
    ).toBe(false);
  });

  it("requires a complete, unexpired and non-invalidated proof", () => {
    expect(
      hasCurrentSiteOwnershipProof(proof({ ownershipTokenHash: null }), now),
    ).toBe(false);
    expect(
      hasCurrentSiteOwnershipProof(proof({ ownershipExpiresAt: now }), now),
    ).toBe(false);
    expect(
      hasCurrentSiteOwnershipProof(proof({ ownershipInvalidatedAt: now }), now),
    ).toBe(false);
    expect(hasCurrentSiteOwnershipProof(proof({ status: "paused" }), now)).toBe(
      false,
    );
  });

  it("accepts fragmented TXT records only when the joined token matches", () => {
    expect(
      matchesSiteOwnershipToken([["agency-monitor=", "sample-token"]], hash),
    ).toBe(true);
    expect(matchesSiteOwnershipToken([["agency-monitor=wrong"]], hash)).toBe(
      false,
    );
    expect(matchesSiteOwnershipToken([], hash)).toBe(false);
  });

  it("distinguishes an absent TXT from transient DNS failure", () => {
    expect(classifyOwnershipDnsFailure({ code: "ENODATA" })).toBe("missing");
    expect(classifyOwnershipDnsFailure({ code: "ENOTFOUND" })).toBe("missing");
    expect(classifyOwnershipDnsFailure({ code: "ESERVFAIL" })).toBe(
      "unavailable",
    );
    expect(classifyOwnershipDnsFailure({ code: "ETIMEOUT" })).toBe(
      "unavailable",
    );
  });

  it("uses 30 days by default and validates the configured range", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(getSiteOwnershipProofTtlMs({})).toBe(30 * day);
    expect(
      getSiteOwnershipProofTtlMs({ SITE_OWNERSHIP_PROOF_TTL_DAYS: "1" }),
    ).toBe(day);
    expect(
      getSiteOwnershipProofTtlMs({ SITE_OWNERSHIP_PROOF_TTL_DAYS: "90" }),
    ).toBe(90 * day);
    for (const value of ["0", "91", "1.5", "abc"]) {
      expect(() =>
        getSiteOwnershipProofTtlMs({ SITE_OWNERSHIP_PROOF_TTL_DAYS: value }),
      ).toThrow();
    }
  });
});
