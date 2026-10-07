import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CookieConsentDetails } from "./cookie-consent-details";

describe("cookie evidence", () => {
  it("shows known and unknown evidence without exposing a cookie value", () => {
    const html = renderToStaticMarkup(
      createElement(CookieConsentDetails, {
        observedAt: new Date("2026-10-06T10:00:00Z"),
        observation: {
          method: "fresh-context-no-interaction",
          status: "limited",
          observedWindowMs: 1200,
          knownTrackerCount: 1,
          unknownPurposeCount: 1,
          excludedThirdPartyRequests: 2,
          reasons: ["time-budget"],
          cookies: [
            {
              name: "_tracking",
              domain: "example.com",
              purpose: "analytics",
              provider: "Signature connue",
              firstObservedAfterLoadMs: 400,
              value: "SECRET_COOKIE_VALUE",
            },
            {
              name: "unknown",
              domain: "example.com",
              purpose: "unknown",
              value: "ANOTHER_SECRET",
            },
          ],
        },
      }),
    );
    expect(html).toContain("Signature connue");
    expect(html).toContain("Aucune signature reconnue");
    expect(html).toContain("Premier relevé");
    expect(html).toContain("Observation limitée");
    expect(html).toContain("2 requête(s) exclue(s)");
    expect(html).not.toContain("SECRET_COOKIE_VALUE");
    expect(html).not.toContain("ANOTHER_SECRET");
  });

  it("states when the observation was unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(CookieConsentDetails, {
        observation: {
          method: "fresh-context-no-interaction",
          status: "unavailable",
          observedWindowMs: 0,
          cookies: [],
        },
      }),
    );
    expect(html).toContain("Observation indisponible");
  });
});
