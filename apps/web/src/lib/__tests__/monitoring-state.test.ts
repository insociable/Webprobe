import { describe, expect, it } from "vitest";
import { getMonitoringState } from "../monitoring-state";

describe("monitoring state", () => {
  it("requires verification for an unverified site", () => {
    expect(
      getMonitoringState({
        status: "pending_verification",
        verifiedAt: null,
        scheduleEnabled: false,
      }).key,
    ).toBe("verification_required");
  });

  it("keeps a verified site inactive until scheduling is enabled", () => {
    expect(
      getMonitoringState({
        status: "active",
        verifiedAt: new Date(),
        scheduleEnabled: false,
      }).key,
    ).toBe("inactive");
  });

  it("reports active only for a verified site with an enabled schedule", () => {
    expect(
      getMonitoringState({
        status: "active",
        verifiedAt: new Date(),
        scheduleEnabled: true,
      }).key,
    ).toBe("active");
  });

  it("keeps paused distinct from active monitoring", () => {
    expect(
      getMonitoringState({
        status: "paused",
        verifiedAt: new Date(),
        scheduleEnabled: true,
      }).key,
    ).toBe("paused");
  });

  it("fails closed when a paused site has no verification timestamp", () => {
    expect(
      getMonitoringState({
        status: "paused",
        verifiedAt: null,
        scheduleEnabled: true,
      }).key,
    ).toBe("verification_required");
  });
});
