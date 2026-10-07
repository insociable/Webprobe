import { describe, expect, it } from "vitest";
import { fleetAttention } from "../fleet-attention";

type Site = Parameters<typeof fleetAttention>[0];
const base = {
  id: "site-id",
  organizationId: "org-id",
  status: "active",
  verifiedAt: null,
  ownershipExpiresAt: null,
  monitoringScheduleEnabled: false,
  monitoringNextRunAt: null,
  openFollowupCount: 0,
  latestScan: null,
} as unknown as Site;

describe("fleet action routing", () => {
  it("routes a failed scheduled scan to the site and a major finding to its scan", () => {
    const scan = {
      id: "scan-id",
      status: "failed",
      trigger: "scheduled",
      queuedAt: new Date(),
      highCount: 0,
      criticalCount: 0,
      newMajorCount: 0,
    };
    const failed = fleetAttention({ ...base, latestScan: scan } as Site);
    expect(failed.urgency).toBe("urgent");
    expect(failed.action.href).toContain("/sites/site-id");
    const major = fleetAttention({
      ...base,
      latestScan: {
        ...scan,
        status: "completed",
        trigger: "manual",
        highCount: 1,
        newMajorCount: 1,
      },
    } as Site);
    expect(major.action.href).toContain("/scans/scan-id");
    expect(major.notes.join(" ")).toContain("nouveau");
  });
  it("uses the scheduled date to mark a scan overdue", () => {
    const due = fleetAttention(
      {
        ...base,
        monitoringScheduleEnabled: true,
        monitoringNextRunAt: new Date("2026-10-06T00:00:00Z"),
      } as Site,
      new Date("2026-10-07T00:00:00Z"),
    );
    expect(due.scanOverdue).toBe(true);
    const future = fleetAttention(
      {
        ...base,
        monitoringScheduleEnabled: true,
        monitoringNextRunAt: new Date("2026-10-08T00:00:00Z"),
      } as Site,
      new Date("2026-10-07T00:00:00Z"),
    );
    expect(future.scanOverdue).toBe(false);
  });
});
