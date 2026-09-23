import { describe, expect, it } from "vitest";
import { getPublicAuditRetentionPolicy } from "../src/public-audit-retention.js";

describe("public audit retention policy", () => {
  it("uses bounded conservative defaults", () => {
    expect(getPublicAuditRetentionPolicy({})).toEqual({
      retentionDays: 90,
      batchSize: 100,
      intervalMs: 6 * 60 * 60 * 1000,
    });
  });

  it("accepts bounded overrides and rejects unsafe values", () => {
    expect(
      getPublicAuditRetentionPolicy({
        PUBLIC_AUDIT_RETENTION_DAYS: "180",
        PUBLIC_AUDIT_RETENTION_BATCH_SIZE: "250",
        PUBLIC_AUDIT_RETENTION_INTERVAL_SECONDS: "3600",
      }),
    ).toEqual({
      retentionDays: 180,
      batchSize: 250,
      intervalMs: 3_600_000,
    });

    expect(
      getPublicAuditRetentionPolicy({
        PUBLIC_AUDIT_RETENTION_DAYS: "0",
        PUBLIC_AUDIT_RETENTION_BATCH_SIZE: "5000",
        PUBLIC_AUDIT_RETENTION_INTERVAL_SECONDS: "5",
      }),
    ).toEqual({
      retentionDays: 90,
      batchSize: 100,
      intervalMs: 6 * 60 * 60 * 1000,
    });
  });
});
