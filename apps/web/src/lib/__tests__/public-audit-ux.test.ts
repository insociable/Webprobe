import { describe, expect, it } from "vitest";
import { deriveSiteDisplayName } from "../site-display-name";

describe("Public Audit site display name", () => {
  it("derives a concise name from the audited hostname", () => {
    expect(deriveSiteDisplayName("https://www.entreprise.fr/path")).toBe(
      "entreprise.fr",
    );
  });

  it("keeps an explicit user-provided display name when present", () => {
    expect(
      deriveSiteDisplayName("https://entreprise.fr/", "  Site corporate  "),
    ).toBe("Site corporate");
  });

  it("ignores an unusable one-character custom name", () => {
    expect(deriveSiteDisplayName("https://odile.cloud/", "x")).toBe(
      "odile.cloud",
    );
  });
});
