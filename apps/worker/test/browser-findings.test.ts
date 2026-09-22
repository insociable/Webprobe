import { describe, expect, it } from "vitest";
import {
  accessibilitySeverity,
  generateBrowserFindings,
  type BrowserPageObservation,
} from "../src/browser-findings.js";

function observation(
  overrides: Partial<BrowserPageObservation> = {},
): BrowserPageObservation {
  return {
    url: "https://example.com/page",
    sourcePageUrl: "https://example.com/",
    statusCode: 200,
    navigationFailed: false,
    javascriptErrorCount: 0,
    accessibilityViolations: [],
    ...overrides,
  };
}

describe("browser finding generation", () => {
  it("reports broken internal links without storing response bodies", () => {
    const findings = generateBrowserFindings([
      observation({ statusCode: 404 }),
      observation({
        url: "https://example.com/server-error",
        statusCode: 503,
      }),
      observation({
        url: "https://example.com/down",
        statusCode: null,
        navigationFailed: true,
      }),
    ]);

    expect(findings).toEqual([
      expect.objectContaining({
        category: "broken-link",
        severity: "medium",
        code: "broken-link.http-error",
        evidence: {
          sourcePageUrl: "https://example.com/",
          statusCode: 404,
        },
      }),
      expect.objectContaining({
        category: "broken-link",
        severity: "high",
        code: "broken-link.http-error",
      }),
      expect.objectContaining({
        category: "broken-link",
        severity: "medium",
        code: "broken-link.navigation-failed",
      }),
    ]);
    expect(findings.every((finding) => finding.fingerprint.length === 64)).toBe(
      true,
    );
  });

  it("does not classify the root document itself as a broken link", () => {
    const findings = generateBrowserFindings([
      observation({
        sourcePageUrl: null,
        statusCode: 404,
      }),
    ]);

    expect(findings).toEqual([]);
  });

  it("aggregates uncaught JavaScript errors without persisting messages", () => {
    const findings = generateBrowserFindings([
      observation({ javascriptErrorCount: 3 }),
    ]);

    expect(findings).toEqual([
      expect.objectContaining({
        category: "javascript",
        severity: "medium",
        code: "javascript.uncaught-error",
        evidence: { errorCount: 3 },
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain("stack");
    expect(JSON.stringify(findings)).not.toContain("message");
  });

  it("maps automated accessibility impacts conservatively", () => {
    expect(accessibilitySeverity("critical")).toBe("high");
    expect(accessibilitySeverity("serious")).toBe("medium");
    expect(accessibilitySeverity("moderate")).toBe("low");
    expect(accessibilitySeverity("minor")).toBe("info");
    expect(accessibilitySeverity(null)).toBe("info");

    const findings = generateBrowserFindings([
      observation({
        accessibilityViolations: [
          {
            ruleId: "color-contrast",
            impact: "serious",
            nodeCount: 4,
          },
        ],
      }),
    ]);

    expect(findings).toEqual([
      expect.objectContaining({
        category: "accessibility",
        severity: "medium",
        code: "accessibility.color-contrast",
        evidence: {
          ruleId: "color-contrast",
          impact: "serious",
          nodeCount: 4,
        },
      }),
    ]);
  });

  it("keeps fingerprints stable for the same page and rule", () => {
    const first = generateBrowserFindings([
      observation({ javascriptErrorCount: 1 }),
    ])[0];
    const second = generateBrowserFindings([
      observation({ javascriptErrorCount: 5 }),
    ])[0];

    expect(first?.fingerprint).toBe(second?.fingerprint);
  });
});
