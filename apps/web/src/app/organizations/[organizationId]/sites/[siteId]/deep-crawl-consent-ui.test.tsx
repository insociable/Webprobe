import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/current-session", () => ({
  requireCurrentSession: vi.fn(async () => ({
    user: { id: "user-fixture" },
  })),
}));
vi.mock("@/lib/deep-crawl-consents", () => ({
  grantDeepCrawlConsent: vi.fn(async () => ({})),
  revokeDeepCrawlConsent: vi.fn(async () => ({ revoked: true })),
  DeepCrawlConsentError: class DeepCrawlConsentError extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  grantDeepCrawlConsentAction,
  revokeDeepCrawlConsentAction,
} from "./deep-crawl-consent-actions";
import { DeepCrawlConsentPanel } from "./deep-crawl-consent-panel";
import { grantDeepCrawlConsent } from "@/lib/deep-crawl-consents";

const original = process.env.WEBPROBE_DEEP_MULTIPAGE_CONSENT_UI;
afterEach(() => {
  if (original === undefined)
    delete process.env.WEBPROBE_DEEP_MULTIPAGE_CONSENT_UI;
  else process.env.WEBPROBE_DEEP_MULTIPAGE_CONSENT_UI = original;
  vi.clearAllMocks();
});
const org = "ddff03a0-a30b-49ad-ae65-8ac87ee590b5";
const site = "eab6c5a1-8316-4215-8950-f64f307adc8a";
const empty = { error: null, message: null };

describe("Deep consent opt-in actions", () => {
  it("is fail-closed without explicit feature flag, even when invoked directly", async () => {
    delete process.env.WEBPROBE_DEEP_MULTIPAGE_CONSENT_UI;
    const form = new FormData();
    form.set("confirmation", "yes");
    form.set("maxPages", "3");
    form.set("pathPrefixes", "/blog/");
    const state = await grantDeepCrawlConsentAction(org, site, empty, form);
    expect(state.error).toContain("pas activée");
    const revoked = await revokeDeepCrawlConsentAction(org, site, empty, form);
    expect(revoked.error).toContain("pas activée");
    expect(grantDeepCrawlConsent).not.toHaveBeenCalled();
  });
  it("requires exact confirmation when enabled", async () => {
    process.env.WEBPROBE_DEEP_MULTIPAGE_CONSENT_UI = "enabled";
    const form = new FormData();
    form.set("maxPages", "3");
    form.set("pathPrefixes", "/blog/");
    const state = await grantDeepCrawlConsentAction(org, site, empty, form);
    expect(state.error).toContain("Confirmez");
    expect(grantDeepCrawlConsent).not.toHaveBeenCalled();
  });
  it("requires bounded form values before invoking a consent service", async () => {
    process.env.WEBPROBE_DEEP_MULTIPAGE_CONSENT_UI = "enabled";
    const form = new FormData();
    form.set("confirmation", "yes");
    form.set("maxPages", "40");
    form.set("pathPrefixes", "/blog/");
    const state = await grantDeepCrawlConsentAction(org, site, empty, form);
    expect(state.error).toContain("invalides");
    expect(grantDeepCrawlConsent).not.toHaveBeenCalled();
  });
});

describe("Deep consent panel accessibility", () => {
  it("explains that recording consent does not start a scan", () => {
    const html = renderToStaticMarkup(
      createElement(DeepCrawlConsentPanel, {
        organizationId: org,
        siteId: site,
        canManage: true,
        consent: null,
      }),
    );
    expect(html).toContain("n’active aucun nouveau parcours");
    expect(html).toContain("confirmation");
    expect(html).toContain("Chemins HTML autorisés");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Plafond des pages");
  });
  it("provides a non-editable status view to ordinary members", () => {
    const html = renderToStaticMarkup(
      createElement(DeepCrawlConsentPanel, {
        organizationId: org,
        siteId: site,
        canManage: false,
        consent: null,
      }),
    );
    expect(html).toContain("Seuls les propriétaires");
    expect(html).not.toContain("Enregistrer le consentement");
  });
});
