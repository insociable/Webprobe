import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ createSiteAction: vi.fn() }));

import { SiteForm } from "./site-form";

describe("site creation form accessibility", () => {
  it("associates the URL instructions with the required field", () => {
    const html = renderToStaticMarkup(
      <SiteForm organizationId="00000000-0000-4000-8000-000000000001" />,
    );
    expect(html).toContain('name="canonicalUrl"');
    expect(html).toContain('aria-describedby="site-url-help"');
    expect(html).toContain('id="site-url-help"');
    expect(html).toContain("Nom affiché dans WebProbe");
  });
});
