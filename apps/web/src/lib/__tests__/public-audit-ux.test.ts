import { describe, expect, it } from "vitest";
import { deriveSiteDisplayName } from "../site-display-name";

describe("Public Audit site display name", () => {
  it("derives a concise name from the audited hostname", () => {
    expect(deriveSiteDisplayName("https://www.entreprise.example/path")).toBe(
      "entreprise.example",
    );
  });

  it("keeps an explicit user-provided display name when present", () => {
    expect(
      deriveSiteDisplayName(
        "https://entreprise.example/",
        "  Site corporate  ",
      ),
    ).toBe("Site corporate");
  });

  it("ignores an unusable one-character custom name", () => {
    expect(deriveSiteDisplayName("https://odile.example/", "x")).toBe(
      "odile.example",
    );
  });
});
