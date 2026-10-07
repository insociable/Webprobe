import { canResolveFindingFromSummary } from "@agency-saas/contracts";

export function decideFindingFollowup(input: {
  status: string;
  code: string;
  observed: boolean;
  summary: unknown;
}): { status: string; event: "reopened" | "suggested" | null } {
  if (input.observed) {
    if (input.status === "fixed") return { status: "todo", event: "reopened" };
    if (input.status === "to_verify")
      return { status: "in_progress", event: "reopened" };
    return { status: input.status, event: null };
  }
  if (
    input.status !== "fixed" &&
    input.status !== "accepted" &&
    input.status !== "to_verify" &&
    canResolveFindingFromSummary(input.code, input.summary)
  ) {
    return { status: "to_verify", event: "suggested" };
  }
  return { status: input.status, event: null };
}
