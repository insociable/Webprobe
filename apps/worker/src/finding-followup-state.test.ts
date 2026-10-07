import { describe, expect, it } from "vitest";
import { decideFindingFollowup } from "./finding-followup-state.js";

describe("finding followup on a later scan", () => {
  it("reopens a fixed finding when its fingerprint returns", () => {
    expect(
      decideFindingFollowup({
        status: "fixed",
        code: "security-header.csp.missing",
        observed: true,
        summary: {},
      }),
    ).toEqual({ status: "todo", event: "reopened" });
  });
  it("moves a verified absence to human review, never directly to fixed", () => {
    const result = decideFindingFollowup({
      status: "in_progress",
      code: "security-header.csp.missing",
      observed: false,
      summary: {},
    });
    expect(result).toEqual({ status: "to_verify", event: "suggested" });
  });
  it("keeps accepted risks and ambiguous absences unchanged", () => {
    expect(
      decideFindingFollowup({
        status: "accepted",
        code: "security-header.csp.missing",
        observed: false,
        summary: {},
      }).event,
    ).toBeNull();
    expect(
      decideFindingFollowup({
        status: "todo",
        code: "network.resource-failed",
        observed: false,
        summary: {},
      }).event,
    ).toBeNull();
  });
});
