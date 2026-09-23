import { describe, expect, it } from "vitest";
import { normalizeDisplayName, parseDisplayName } from "../user-profile";

describe("user profile display name", () => {
  it("normalizes surrounding and repeated whitespace", () => {
    expect(normalizeDisplayName("  Sébastien   Legendre  ")).toBe(
      "Sébastien Legendre",
    );
  });

  it("accepts a human-readable display name", () => {
    expect(parseDisplayName("  Sébastien  ")).toBe("Sébastien");
  });

  it("rejects blank, too short and too long values", () => {
    expect(parseDisplayName(" ")).toBeNull();
    expect(parseDisplayName("A")).toBeNull();
    expect(parseDisplayName("x".repeat(81))).toBeNull();
  });
});
