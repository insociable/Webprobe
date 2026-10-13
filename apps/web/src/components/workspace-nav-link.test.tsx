import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let currentPath = "/sites";
vi.mock("next/navigation", () => ({ usePathname: () => currentPath }));

import { WorkspaceNavLink } from "./workspace-nav-link";

describe("workspace navigation", () => {
  it("marks the exact page and the current site section", () => {
    currentPath = "/sites";
    expect(
      renderToStaticMarkup(
        <WorkspaceNavLink href="/sites">Sites</WorkspaceNavLink>,
      ),
    ).toContain('aria-current="page"');

    currentPath = "/organizations/org/sites/site";
    expect(
      renderToStaticMarkup(
        <WorkspaceNavLink href="/sites">Sites</WorkspaceNavLink>,
      ),
    ).toContain('aria-current="location"');
    currentPath = "/organizations/org";
    expect(
      renderToStaticMarkup(
        <WorkspaceNavLink href="/sites">Sites</WorkspaceNavLink>,
      ),
    ).not.toContain("aria-current");

    expect(
      renderToStaticMarkup(
        <WorkspaceNavLink href="/guide">Guide</WorkspaceNavLink>,
      ),
    ).not.toContain("aria-current");
  });
});
