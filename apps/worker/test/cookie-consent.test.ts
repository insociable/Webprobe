import { describe, expect, it } from "vitest";
import {
  assessCookieConsent,
  classifyConsentCookie,
} from "../src/scan-engine/cookie-consent-analysis.js";
import { observeCookiesBeforeInteraction } from "../src/scan-engine/cookie-consent-observation.js";
import type { BrowserContext } from "playwright";

const cookie = (name: string) => ({
  name,
  value: "private-value-never-persisted",
  domain: ".example.com",
  path: "/",
  secure: true,
  httpOnly: false,
  sameSite: "Lax" as const,
  expires: -1,
});

describe("cookies before any interaction", () => {
  it.each([
    ["_ga", "analytics"],
    ["_ga_ABC123", "analytics"],
    ["_gcl_au", "advertising"],
    ["li_fat_id", "advertising"],
    ["_clck", "session-replay"],
    ["_clsk", "session-replay"],
  ])("recognizes the documented name %s", (name, purpose) => {
    expect(classifyConsentCookie(name)).toMatchObject({
      purpose,
      provider: expect.any(String),
      source: expect.stringMatching(/^https:/),
    });
  });

  it.each([
    "session",
    "PHPSESSID",
    "consent",
    "_ga_session",
    "_ga_extra_suffix",
    "my_ga",
    "_gcl_",
    "_clck_backup",
    "LI_FAT_ID",
    "__proto__",
  ])("keeps %s unknown rather than guessing necessity or a vendor", (name) =>
    expect(classifyConsentCookie(name).purpose).toBe("unknown"),
  );

  it("retains HTTP and delayed JS cookies, including one removed before the last sample, without values", async () => {
    const started = Date.now();
    let samples = 0;
    const context = {
      cookies: async () => {
        samples++;
        const elapsed = Date.now() - started;
        return [
          cookie("_ga"),
          ...(elapsed >= 250 ? [cookie("_clck")] : []),
          ...(elapsed < 1_500 ? [cookie("transient")] : []),
          cookie("session"),
        ];
      },
    } as Pick<BrowserContext, "cookies">;
    const observation = await observeCookiesBeforeInteraction({
      context,
      remainingDurationMs: () => 10_000,
      beforeObservation: async () => undefined,
      signal: new AbortController().signal,
    });
    expect(observation.status).toBe("observed");
    expect(observation.observedWindowMs).toBeGreaterThanOrEqual(3_000);
    expect(samples).toBeGreaterThan(2);
    expect(observation.cookies.map((item) => item.name)).toEqual(
      expect.arrayContaining(["_ga", "_clck", "transient", "session"]),
    );
    const assessment = assessCookieConsent(observation, 2);
    expect(assessment.findings).toHaveLength(2);
    expect(assessment.findings.every((item) => item.level === "review")).toBe(
      true,
    );
    expect(assessment.details.unknownPurposeCount).toBe(2);
    expect(assessment.details.excludedThirdPartyRequests).toBe(2);
    expect(JSON.stringify({ observation, assessment })).not.toContain(
      "private-value",
    );
    expect(
      observation.cookies.some((item) => Object.hasOwn(item, "value")),
    ).toBe(false);
  }, 6_000);

  it("does not turn an unavailable browser observation into a consent success", () => {
    const result = assessCookieConsent(undefined, 0);
    expect(result.details.status).toBe("unavailable");
    expect(result.summary).toContain("aucune conclusion");
    expect(result.findings).toEqual([]);
  });

  it("does not read cookies when the duration budget is exhausted", async () => {
    let reads = 0;
    const observation = await observeCookiesBeforeInteraction({
      context: {
        cookies: async () => {
          reads++;
          return [];
        },
      },
      remainingDurationMs: () => 1_000,
      beforeObservation: async () => undefined,
    });
    expect(reads).toBe(0);
    expect(observation).toMatchObject({
      status: "unavailable",
      reasons: ["time-budget"],
      sampleCount: 0,
    });
  });

  it("bounds a failing cookie read and reports it as unavailable", async () => {
    const observation = await observeCookiesBeforeInteraction({
      context: {
        cookies: async () => {
          throw new Error("private error");
        },
      },
      remainingDurationMs: () => 10_000,
      beforeObservation: async () => undefined,
    });
    expect(observation).toMatchObject({
      status: "unavailable",
      reasons: expect.arrayContaining(["cookie-read-failed"]),
    });
    expect(JSON.stringify(observation)).not.toContain("private error");
  });

  it("retains positive evidence when time runs out and reports truncation", async () => {
    let remaining = 5_000;
    const observation = await observeCookiesBeforeInteraction({
      context: {
        cookies: async () => {
          remaining = 2_000;
          return Array.from({ length: 121 }, (_, index) =>
            cookie(index === 0 ? "_ga" : `unknown_${index}`),
          );
        },
      },
      remainingDurationMs: () => remaining,
      beforeObservation: async () => undefined,
    });
    expect(observation).toMatchObject({
      status: "limited",
      reasons: expect.arrayContaining(["cookie-limit", "time-budget"]),
    });
    expect(observation.cookies).toHaveLength(120);
    expect(assessCookieConsent(observation, 0).findings).toHaveLength(1);
  });

  it("aborts a hanging snapshot without continuing to observe", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20);
    try {
      await expect(
        observeCookiesBeforeInteraction({
          context: { cookies: async () => new Promise<never>(() => undefined) },
          remainingDurationMs: () => 10_000,
          beforeObservation: async () => undefined,
          signal: controller.signal,
        }),
      ).rejects.toThrow("aborted");
    } finally {
      clearTimeout(timer);
    }
  });
});
