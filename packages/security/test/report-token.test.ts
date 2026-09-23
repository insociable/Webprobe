import { describe, expect, it } from "vitest";
import {
  decryptReportShareToken,
  encryptReportShareToken,
  generateReportShareToken,
  getReportPublicBaseUrl,
  getReportTokenSecret,
  hashReportShareToken,
  isReportShareToken,
} from "../src/index.js";

const secret = "test-report-token-secret-that-is-long-enough";

describe("report share token protection", () => {
  it("requires dedicated report credentials and HTTPS in production", () => {
    const authSecret = "a".repeat(32);
    expect(() =>
      getReportTokenSecret({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: authSecret,
      }),
    ).toThrow();
    expect(() =>
      getReportTokenSecret({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: authSecret,
        REPORT_TOKEN_SECRET: authSecret,
      }),
    ).toThrow();
    expect(
      getReportTokenSecret({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: authSecret,
        REPORT_TOKEN_SECRET: "b".repeat(32),
      }),
    ).toBe("b".repeat(32));
    expect(() =>
      getReportPublicBaseUrl({
        NODE_ENV: "production",
        REPORT_PUBLIC_BASE_URL: "http://example.com",
      }),
    ).toThrow();
    expect(
      getReportPublicBaseUrl({
        NODE_ENV: "production",
        REPORT_PUBLIC_BASE_URL: "https://example.com/",
      }),
    ).toBe("https://example.com");
    expect(() =>
      getReportPublicBaseUrl({
        NODE_ENV: "production",
        REPORT_PUBLIC_BASE_URL: "https://example.com/report",
      }),
    ).toThrow();
  });
  it("generates unguessable fixed-shape tokens and hashes them", () => {
    const first = generateReportShareToken();
    const second = generateReportShareToken();

    expect(first).not.toBe(second);
    expect(isReportShareToken(first)).toBe(true);
    expect(hashReportShareToken(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("encrypts and decrypts without storing the token as plaintext", () => {
    const token = generateReportShareToken();
    const encrypted = encryptReportShareToken(token, secret);

    expect(encrypted).not.toContain(token);
    expect(decryptReportShareToken(encrypted, secret)).toBe(token);
  });

  it("rejects tampering and weak secrets", () => {
    const token = generateReportShareToken();
    const encrypted = encryptReportShareToken(token, secret);
    const parts = encrypted.split(".");
    const ciphertext = parts[2]!;
    const first = ciphertext[0] === "A" ? "B" : "A";
    parts[2] = `${first}${ciphertext.slice(1)}`;
    const tampered = parts.join(".");

    expect(() => decryptReportShareToken(tampered, secret)).toThrow();
    expect(() => encryptReportShareToken(token, "too-short")).toThrow();
  });
});
