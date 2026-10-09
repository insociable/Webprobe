import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThirdPartyPanel } from "./third-party-panel";
import type { ThirdPartyRow } from "@/lib/third-party-service";

vi.mock("./third-party-actions", () => ({
  setThirdPartyDecisionAction: async () => undefined,
}));

const base: ThirdPartyRow = {
  providerId: "cloudflare",
  confidence: "high",
  evidence: ["Header CF-Ray observé"],
  detectedAt: new Date(),
  status: "pending",
  provider: null,
};

function render(row: ThirdPartyRow) {
  return renderToStaticMarkup(
    <ThirdPartyPanel
      rows={[row]}
      organizationId="00000000-0000-4000-8000-000000000001"
      siteId="00000000-0000-4000-8000-000000000002"
      canManage
    />,
  );
}

describe("third-party site panel", () => {
  it("shows technical evidence, confidence, confirmation and attribution", () => {
    const html = render(base);
    expect(html).toContain("Header CF-Ray observé");
    expect(html).toContain("Confiance élevée");
    expect(html).toContain("Confirmer");
    expect(html).toContain("Ignorer");
    expect(html).toContain("https://stacklegal.eu");
    expect(html).toContain("ne constitue pas une qualification juridique");
  });

  it("marks partial data and missing fields without filling them", () => {
    const html = render({
      ...base,
      status: "confirmed",
      provider: {
        id: "cloudflare",
        name: "Cloudflare",
        legalName: null,
        category: null,
        purpose: null,
        location: null,
        transfer: [],
        dpfStatus: null,
        officialUrl: null,
        officialUrlKind: null,
        pageUrl: "https://stacklegal.eu/rgpd/cloudflare",
        lastVerified: null,
        verification: "partial",
        missing: ["transfer"],
        aliases: [],
      },
    });
    expect(html).toContain("Informations partielles");
    expect(html).toContain("Mécanisme de transfert");
    expect(html).toContain("Non renseigné");
  });

  it("shows degraded and ignored states", () => {
    expect(render({ ...base, status: "confirmed" })).toContain(
      "temporairement indisponible",
    );
    const ignored = render({ ...base, status: "ignored" });
    expect(ignored).toContain("ignoré par votre organisation");
    expect(ignored).not.toContain(
      "Enrichissement StackLégal temporairement indisponible",
    );
  });
});
