import { describe, expect, it } from "vitest";
import { groupFindingsForDisplay } from "../finding-display";

describe("finding display grouping", () => {
  it("groups repeated findings by code while preserving affected URLs", () => {
    const groups = groupFindingsForDisplay([
      { code: "accessibility.region", pageUrl: "https://example.com/a" },
      { code: "accessibility.region", pageUrl: "https://example.com/b" },
      { code: "accessibility.region", pageUrl: "https://example.com/a" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.occurrenceCount).toBe(3);
    expect(groups[0]?.findings).toHaveLength(3);
    expect(groups[0]?.pageUrls).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("keeps different rule codes as distinct issues", () => {
    const groups = groupFindingsForDisplay([
      { code: "accessibility.region", pageUrl: "https://example.com/a" },
      {
        code: "accessibility.landmark-one-main",
        pageUrl: "https://example.com/a",
      },
    ]);

    expect(groups).toHaveLength(2);
  });

  it("preserves first-seen order so severity-sorted input remains prioritized", () => {
    const groups = groupFindingsForDisplay([
      { code: "security-header.csp.missing", pageUrl: "https://example.com/" },
      { code: "accessibility.region", pageUrl: "https://example.com/a" },
      { code: "security-header.csp.missing", pageUrl: "https://example.com/b" },
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "security-header.csp.missing",
      "accessibility.region",
    ]);
  });
});
