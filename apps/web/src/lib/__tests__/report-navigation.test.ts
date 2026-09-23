import { describe, expect, it } from "vitest";
import { reportActionAnchorId } from "../report-navigation";

describe("report navigation anchors", () => {
  it("is deterministic and safe for an HTML id", () => {
    const first = reportActionAnchorId("security-header.csp/missing");
    const second = reportActionAnchorId("security-header.csp/missing");

    expect(first).toBe(second);
    expect(first).toMatch(/^action-[a-z0-9-]+-[a-z0-9]+$/);
  });

  it("keeps different raw keys distinct after normalization", () => {
    expect(reportActionAnchorId("tls:weak")).not.toBe(
      reportActionAnchorId("tls/weak"),
    );
  });
});
