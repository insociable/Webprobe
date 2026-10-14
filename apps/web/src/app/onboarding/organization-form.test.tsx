import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ createInitialOrganizationAction: vi.fn() }));

import { OrganizationForm } from "./organization-form";

describe("onboarding form accessibility", () => {
  it("associates the name instructions with the required field", () => {
    const html = renderToStaticMarkup(
      <OrganizationForm initialDisplayName="Alex" />,
    );
    expect(html).toContain('name="displayName"');
    expect(html).toContain('aria-describedby="onboarding-name-help"');
    expect(html).toContain('id="onboarding-name-help"');
    expect(html).toContain('value="Alex"');
  });
});
