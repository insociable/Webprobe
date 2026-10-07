import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ importSitesAction: vi.fn() }));

import { ImportForm } from "./import-form";

describe("CSV import form", () => {
  it("renders an empty preview state on the initial request", () => {
    const html = renderToStaticMarkup(
      <ImportForm organizationId="00000000-0000-4000-8000-000000000001" />,
    );
    expect(html).toContain("Prévisualiser");
    expect(html).toContain("url,name");
    expect(html).not.toContain("Aperçu avant enregistrement");
  });
});
