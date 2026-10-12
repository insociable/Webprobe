import { describe, expect, it } from "vitest";
import {
  compressionAccepted,
  performanceCacheControl,
  performanceContentEncoding,
  performanceContentType,
  performanceExpires,
} from "../src/scanner-v2/performance-metadata.js";
describe("bounded performance metadata", () => {
  it("retains known cache directives and dates without arbitrary header parameters", () => {
    expect(
      performanceCacheControl(
        'private="authorization-secret", max-age="3600", token=hidden',
      ),
    ).toBe("private, max-age=3600");
    expect(performanceCacheControl("token=hidden")).toBe("policy-unrecognized");
    expect(
      performanceCacheControl("public, " + "x".repeat(2048) + ", private"),
    ).toBe("policy-unrecognized");
    expect(performanceExpires("private-secret")).toBeNull();
    expect(performanceContentType("text/html; token=hidden")).toBe("text/html");
    expect(performanceContentType("image//png")).toBeNull();
    expect(performanceContentEncoding("secret")).toBe("other");
  });
  it("does not infer compression negotiation from an unavailable header or a disabled coding", () => {
    expect(compressionAccepted(undefined)).toBeNull();
    expect(compressionAccepted("gzip;q=0, br;q=0")).toBe(false);
    expect(compressionAccepted("gzip;q=0.5, identity;q=1")).toBe(true);
    expect(compressionAccepted("identity")).toBe(false);
  });
});
