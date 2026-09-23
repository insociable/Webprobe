import { describe, expect, it } from "vitest";
import { getPublicAuditLimits } from "../public-audit-policy";

describe("public audit policy", () => {
  it("uses conservative defaults", () => {
    expect(getPublicAuditLimits({})).toEqual({
      userHourlyLimit: 6,
      userConcurrentLimit: 2,
      domainCooldownMs: 600_000,
    });
  });

  it("accepts positive integer overrides", () => {
    expect(
      getPublicAuditLimits({
        PUBLIC_AUDIT_USER_HOURLY_LIMIT: "9",
        PUBLIC_AUDIT_USER_CONCURRENT_LIMIT: "3",
        PUBLIC_AUDIT_DOMAIN_COOLDOWN_SECONDS: "120",
      }),
    ).toEqual({
      userHourlyLimit: 9,
      userConcurrentLimit: 3,
      domainCooldownMs: 120_000,
    });
  });

  it("falls back for invalid or non-positive overrides", () => {
    expect(
      getPublicAuditLimits({
        PUBLIC_AUDIT_USER_HOURLY_LIMIT: "0",
        PUBLIC_AUDIT_USER_CONCURRENT_LIMIT: "nope",
        PUBLIC_AUDIT_DOMAIN_COOLDOWN_SECONDS: "-1",
      }),
    ).toEqual({
      userHourlyLimit: 6,
      userConcurrentLimit: 2,
      domainCooldownMs: 600_000,
    });
  });
});
