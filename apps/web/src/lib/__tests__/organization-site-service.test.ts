import { describe, expect, it } from "vitest";
import { canManageOrganization } from "../organization-permissions";

describe("canManageOrganization", () => {
  it.each(["owner", "admin"] as const)("allows %s", (role) => {
    expect(canManageOrganization(role)).toBe(true);
  });

  it("denies ordinary members", () => {
    expect(canManageOrganization("member")).toBe(false);
  });
});
