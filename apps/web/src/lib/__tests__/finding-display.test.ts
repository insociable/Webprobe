import { describe, expect, it } from "vitest";
import { groupFindingsForDisplay } from "../finding-display";

describe("finding display grouping", () => {
  it("groups seo.noindex findings while preserving affected page URLs", () => {
    const groups = groupFindingsForDisplay([
      { code: "seo.noindex", pageUrl: "https://example.com/a" },
      { code: "seo.noindex", pageUrl: "https://example.com/b" },
      { code: "seo.noindex", pageUrl: "https://example.com/c" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.findings).toHaveLength(3);
    expect(groups[0]?.pageUrls).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
  });

  it("does not group unrelated findings", () => {
    const groups = groupFindingsForDisplay([
      { code: "seo.title.missing", pageUrl: "https://example.com/a" },
      { code: "seo.title.missing", pageUrl: "https://example.com/b" },
    ]);

    expect(groups).toHaveLength(2);
  });
});
