import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceAccountMenu } from "@/components/workspace-account-menu";
import { ProductMark } from "@/components/product-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceNavLink } from "@/components/workspace-nav-link";

type TrailItem = {
  label: string;
  href?: string;
};

type WorkspaceShellProps = {
  children: React.ReactNode;
  trail?: TrailItem[];
};

const navigation = [
  { href: "/dashboard", label: "Tableau de bord", tone: "bg-[#6d7cff]" },
  {
    href: "/sites",
    label: "Sites / Monitoring",
    tone: "bg-[#51d3a5]",
  },
  { href: "/guide", label: "Guide", tone: "bg-[#39c7ff]" },
  { href: "/help", label: "FAQ / Aide", tone: "bg-[#ffb45f]" },
] as const;

export function WorkspaceShell({ children, trail = [] }: WorkspaceShellProps) {
  return (
    <div className="am-workspace">
      <aside className="am-rail">
        <Link href="/dashboard" className="inline-flex">
          <ProductMark />
        </Link>

        <div className="mt-10">
          <p className="px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#59647a]">
            Navigation
          </p>
          <nav className="mt-3 space-y-1" aria-label="Navigation principale">
            {navigation.map((item) => (
              <WorkspaceNavLink
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-sm text-[#aab5c9] transition hover:border-[#29344a] hover:bg-[#101622] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8793ff]"
              >
                <span
                  aria-hidden="true"
                  className={"size-1.5 rounded-sm " + item.tone}
                />
                {item.label}
              </WorkspaceNavLink>
            ))}
          </nav>
        </div>

        <div className="mt-auto space-y-4 border-t border-[#20283a] pt-5">
          <ThemeToggle />
          <div className="flex items-center gap-2 px-2 text-[11px] text-[#6f7b91]">
            <span className="am-status-dot" />
            Service disponible
          </div>
          <WorkspaceAccountMenu />
        </div>
      </aside>

      <div className="am-workspace-main">
        <header className="am-topbar">
          <Link href="/dashboard" className="am-topbar-brand lg:hidden">
            <ProductMark />
          </Link>
          <nav
            aria-label="Fil d’Ariane"
            className="hidden min-w-0 items-center gap-2 text-xs text-[#738097] lg:flex"
          >
            <span className="font-mono uppercase tracking-[0.12em]">
              Portail
            </span>
            {trail.map((item, index) => (
              <span
                key={item.label}
                className="flex min-w-0 items-center gap-2"
              >
                <span aria-hidden="true" className="text-[#3f4b61]">
                  /
                </span>
                {item.href ? (
                  <Link
                    href={item.href}
                    aria-current={
                      index === trail.length - 1 ? "page" : undefined
                    }
                    className="max-w-48 truncate text-[#aab5c9] hover:text-white"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    aria-current={
                      index === trail.length - 1 ? "page" : undefined
                    }
                    className="max-w-48 truncate text-[#aab5c9]"
                  >
                    {item.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
          <div className="am-topbar-actions flex items-center gap-3">
            <div className="lg:hidden">
              <ThemeToggle compact />
            </div>
            <div className="hidden items-center gap-2 text-xs text-[#7f8a9f] sm:flex">
              <span className="am-status-dot" />
              Service disponible
            </div>
            <div className="lg:hidden">
              <SignOutButton compact />
            </div>
          </div>
        </header>
        <nav aria-label="Navigation mobile" className="am-mobile-nav lg:hidden">
          {navigation.map((item) => (
            <WorkspaceNavLink key={item.href} href={item.href}>
              {item.label}
            </WorkspaceNavLink>
          ))}
        </nav>
        {trail.length > 0 ? (
          <nav
            aria-label="Fil d’Ariane"
            className="border-b border-[#242d40] px-4 py-2 text-xs text-[#aab5c9] lg:hidden"
          >
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <li>
                <Link href="/dashboard">Portail</Link>
              </li>
              {trail.map((item, index) => (
                <li key={item.label} className="min-w-0 break-words">
                  <span aria-hidden="true" className="mr-2">
                    /
                  </span>
                  {item.href ? (
                    <Link
                      href={item.href}
                      aria-current={
                        index === trail.length - 1 ? "page" : undefined
                      }
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span
                      aria-current={
                        index === trail.length - 1 ? "page" : undefined
                      }
                    >
                      {item.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <main id="contenu-principal" tabIndex={-1} className="am-content">
          {children}
        </main>
      </div>
    </div>
  );
}
