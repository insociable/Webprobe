import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/sites" }));
vi.mock("@/components/workspace-account-menu", () => ({
  WorkspaceAccountMenu: () => null,
}));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("@/components/product-mark", () => ({ ProductMark: () => null }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/workspace-nav-link", () => ({
  WorkspaceNavLink: () => null,
}));

import { WorkspaceShell } from "./product-shell";

describe("workspace breadcrumbs", () => {
  it.each([
    [{ label: "Sites" }, { label: "Import CSV" }],
    [{ label: "Site de test" }, { label: "Vérification DNS" }],
    [
      { label: "Sites", href: "/sites" },
      { label: "Site", href: "/sites/test" },
    ],
  ])(
    "marks only the last item in both responsive breadcrumbs: %j",
    (...trail) => {
      const html = renderToStaticMarkup(
        <WorkspaceShell trail={trail}>
          <h1>Page de test</h1>
        </WorkspaceShell>,
      );
      const breadcrumbs = html.match(
        /<nav aria-label="Fil d’Ariane"[\s\S]*?<\/nav>/g,
      );
      expect(breadcrumbs).toHaveLength(2);
      for (const breadcrumb of breadcrumbs ?? []) {
        expect(breadcrumb.match(/aria-current="page"/g)).toHaveLength(1);
        expect(breadcrumb).toMatch(
          new RegExp(`aria-current="page"[^>]*>${trail.at(-1)?.label}<`),
        );
      }
    },
  );
});
