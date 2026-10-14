import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { deepCrawlConsents } from "@agency-saas/db";
import {
  assertDeepCrawlConsentRecord,
  loadDeepCrawlPermission,
} from "../src/scan-engine/deep-crawl-current-consent.js";

type RecordRow = typeof deepCrawlConsents.$inferSelect;
const now = new Date("2026-10-14T16:00:00.000Z");
const organizationId = randomUUID();
const siteId = randomUUID();
const ownershipGeneration = randomUUID();
const deepGenerationId = randomUUID();
const expected = {
  organizationId,
  siteId,
  canonicalUrl: "https://example.com/",
  ownershipGeneration,
  deepGenerationId,
  revision: 3,
};
const valid: RecordRow = {
  organizationId,
  siteId,
  canonicalUrl: expected.canonicalUrl,
  ownershipGeneration,
  deepGenerationId,
  revision: 3,
  allowedPathPrefixes: ["/blog/", "/about"],
  maxPages: 3,
  grantedBy: randomUUID(),
  grantedAt: new Date("2026-10-14T15:59:00Z"),
  expiresAt: new Date("2026-10-14T16:59:00Z"),
  revokedAt: null,
  updatedAt: new Date("2026-10-14T15:59:00Z"),
};

describe("Deep persisted consent network guard", () => {
  it("accepts a fresh revision matching both DNS generations", () => {
    expect(() =>
      assertDeepCrawlConsentRecord(valid, now, expected),
    ).not.toThrow();
  });

  it("rejects expired, revoked, missing or renewed grants", () => {
    const invalidRows: Array<RecordRow | undefined> = [
      undefined,
      { ...valid, revokedAt: now },
      { ...valid, expiresAt: now },
      { ...valid, expiresAt: new Date("2026-10-13T16:00:00Z") },
      { ...valid, revision: 4 },
      { ...valid, deepGenerationId: randomUUID() },
      { ...valid, ownershipGeneration: randomUUID() },
      { ...valid, canonicalUrl: "https://other.example/" },
      { ...valid, organizationId: randomUUID() },
      { ...valid, siteId: randomUUID() },
      { ...valid, grantedAt: new Date("2026-10-14T16:01:00Z") },
      { ...valid, maxPages: 6 },
      { ...valid, allowedPathPrefixes: ["/"] },
      { ...valid, allowedPathPrefixes: ["/blog/", "/blog/"] },
      { ...valid, allowedPathPrefixes: ["/admin/"] },
    ];
    for (const row of invalidRows) {
      expect(() => assertDeepCrawlConsentRecord(row, now, expected)).toThrow(
        /unavailable, stale or revoked/,
      );
    }
  });

  it("rejects malformed times and leases longer than 24h", () => {
    const invalid: RecordRow[] = [
      { ...valid, grantedAt: new Date(Number.NaN) },
      { ...valid, expiresAt: new Date(Number.NaN) },
      {
        ...valid,
        expiresAt: new Date(valid.grantedAt.getTime() + 86_400_001),
      },
    ];
    for (const row of invalid) {
      expect(() => assertDeepCrawlConsentRecord(row, now, expected)).toThrow();
    }
    expect(() =>
      assertDeepCrawlConsentRecord(valid, new Date(Number.NaN), expected),
    ).toThrow();
  });

  it("is disabled by default before even opening a DB connection", async () => {
    delete process.env.WEBPROBE_DEEP_MULTIPAGE_RUNTIME;
    await expect(
      loadDeepCrawlPermission({
        lease: {
          scanId: randomUUID(),
          attemptId: randomUUID(),
          attemptNumber: 1,
          token: randomUUID(),
          siteId,
          organizationId,
        },
        grantIdentity: {
          canonicalUrl: expected.canonicalUrl,
          generationId: deepGenerationId,
          siteVerifiedAt: now,
          ownershipGeneration,
          ownershipTokenHash: "a".repeat(64),
          ownershipVerifiedAt: now,
          ownershipRevalidatedAt: now,
        },
      }),
    ).rejects.toThrow(/runtime disabled/);
  });
});

afterEach(() => {
  delete process.env.WEBPROBE_DEEP_MULTIPAGE_RUNTIME;
});
