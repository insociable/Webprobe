import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  expectedDeepProofRecord,
  matchesDeepProof,
} from "../src/scan-engine/deep-proof.js";

describe("deep DNS proof", () => {
  it("binds the record to the canonical host and verifies TXT fragments", () => {
    const token = "agency-monitor-deep=secret-token";
    const hash = createHash("sha256").update(token).digest("hex");
    expect(expectedDeepProofRecord("https://Example.com/path")).toBe(
      "_agency-monitor.example.com",
    );
    expect(
      matchesDeepProof([["agency-monitor-deep=", "secret-token"]], hash),
    ).toBe(true);
    expect(matchesDeepProof([["agency-monitor-deep=other"]], hash)).toBe(false);
    expect(matchesDeepProof([[token]], "invalid")).toBe(false);
  });
});
