import { describe, expect, it } from "vitest";
import { getFindingRemediation } from "../finding-remediation";

describe("finding remediation catalog", () => {
  it("covers every deterministic finding family emitted by the pilot", () => {
    const codes = [
      "security-header.csp.missing",
      "security-header.hsts.missing",
      "security-header.permissions-policy.missing",
      "security-header.x-frame-options.missing",
      "security-header.x-content-type-options.missing",
      "security-header.referrer-policy.missing",
      "security-header.x-powered-by.exposed",
      "tls.certificate-expiring",
      "tls.connection-failed",
      "availability.timeout",
      "availability.network-error",
      "availability.redirect-error",
      "availability.http-5xx",
      "availability.http-4xx",
      "availability.http-3xx-final",
      "performance.http-response-slow",
      "broken-link.http-error",
      "broken-link.navigation-failed",
      "javascript.uncaught-error",
      "seo.title.missing",
      "seo.canonical.invalid",
      "network.http-5xx",
      "network.request-failed",
      "performance.lcp.slow",
      "performance.cls.high",
      "accessibility.region",
      "accessibility.landmark-one-main",
      "accessibility.color-contrast",
      "accessibility.heading-order",
      "accessibility.image-alt",
    ];

    for (const code of codes) {
      expect(getFindingRemediation(code), code).not.toBeNull();
    }
  });

  it("reuses the standard catalog for equivalent Deep finding codes", () => {
    expect(getFindingRemediation("csp-absent")?.title).toBe(
      getFindingRemediation("security-header.csp.missing")?.title,
    );
    expect(getFindingRemediation("hsts-absent")?.title).toBe(
      getFindingRemediation("security-header.hsts.missing")?.title,
    );
    expect(getFindingRemediation("certificate-validation-error")?.title).toBe(
      getFindingRemediation("tls.connection-failed")?.title,
    );
  });

  it("provides detailed guidance for the accessibility rules seen in prospect audits", () => {
    const region = getFindingRemediation("accessibility.region");
    const main = getFindingRemediation("accessibility.landmark-one-main");

    expect(region?.steps.length).toBeGreaterThanOrEqual(4);
    expect(region?.summary).toContain("landmarks");
    expect(main?.steps.length).toBeGreaterThanOrEqual(4);
    expect(main?.summary).toContain("contenu principal");
  });
});