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
      "accessibility.color-contrast",
      "accessibility.heading-order",
      "accessibility.image-alt",
    ];

    for (const code of codes) {
      expect(getFindingRemediation(code), code).not.toBeNull();
    }
  });
});
