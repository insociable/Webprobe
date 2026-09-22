import { describe, expect, it } from "vitest";
import {
  decryptReportShareToken,
  encryptReportShareToken,
  generateReportShareToken,
  hashReportShareToken,
  isReportShareToken,
} from "../src/index.js";

const secret = "test-report-token-secret-that-is-long-enough";

describe("report share token protection", () => {
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
