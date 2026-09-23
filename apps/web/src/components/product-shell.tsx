import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceAccountMenu } from "@/components/workspace-account-menu";
import { ProductMark } from "@/components/product-mark";
import { ThemeToggle } from "@/components/theme-toggle";

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
    href: "/dashboard#sites",
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
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-sm text-[#aab5c9] transition hover:border-[#29344a] hover:bg-[#101622] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8793ff]"
              >
                <span className={"size-1.5 rounded-sm " + item.tone} />
                {item.label}
              </Link>
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
          <Link href="/dashboard" className="lg:hidden">
            <ProductMark />
          </Link>
          <div className="hidden min-w-0 items-center gap-2 text-xs text-[#738097] lg:flex">
            <span className="font-mono uppercase tracking-[0.12em]">
              Portail
            </span>
            {trail.map((item) => (
              <span
                key={item.label}
                className="flex min-w-0 items-center gap-2"
              >
                <span className="text-[#3f4b61]">/</span>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="max-w-48 truncate text-[#aab5c9] hover:text-white"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="max-w-48 truncate text-[#aab5c9]">
                    {item.label}
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3">
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
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="am-content">{children}</main>
      </div>
    </div>
  );
}
