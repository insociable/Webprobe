import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ScanContextError } from "../src/scan-persistence.js";
import { classifyScanError } from "../src/scan-retry.js";

describe("scan retry classification", () => {
  it("does not retry invalid or stale scan context", () => {
    expect(
      classifyScanError(
        new ScanContextError("target changed", "target-mismatch"),
      ),
    ).toEqual({
      retryable: false,
      code: "target-mismatch",
    });
  });

  it("does not retry invalid job payloads", () => {
    let error: unknown;
    try {
      z.string().uuid().parse("not-a-uuid");
    } catch (caught) {
      error = caught;
    }
    expect(classifyScanError(error)).toMatchObject({
      retryable: false,
      code: "invalid-scan-job",
    });
  });

  it("retries explicit transient network failures", () => {
    const error = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    });
    expect(classifyScanError(error)).toEqual({
      retryable: true,
      code: "ECONNRESET",
    });
  });

  it("retries transient database classes", () => {
    const error = Object.assign(new Error("serialization failure"), {
      code: "40001",
    });
    expect(classifyScanError(error)).toEqual({
      retryable: true,
      code: "40001",
    });
  });

  it("retries known browser runtime failures", () => {
    expect(
      classifyScanError(new Error("Initial browser navigation failed")),
    ).toEqual({
      retryable: true,
      code: "browser-runtime-transient",
    });
  });

  it("does not blindly retry unknown errors", () => {
    expect(classifyScanError(new Error("unexpected logic bug"))).toEqual({
      retryable: false,
      code: "Error",
    });
  });
});
