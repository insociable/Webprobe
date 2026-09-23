import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceAccountMenu } from "@/components/workspace-account-menu";
import { ProductMark } from "@/components/product-mark";

type TrailItem = {
  label: string;
  href?: string;
};

type WorkspaceShellProps = {
  children: React.ReactNode;
  trail?: TrailItem[];
};

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
          <nav className="mt-3 space-y-1">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-sm text-[#aab5c9] transition hover:border-[#29344a] hover:bg-[#101622] hover:text-white"
            >
              <span className="size-1.5 rounded-sm bg-[#6d7cff]" />
              Vue générale
            </Link>
            <a
              href="/api/health"
              className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-sm text-[#aab5c9] transition hover:border-[#29344a] hover:bg-[#101622] hover:text-white"
            >
              <span className="size-1.5 rounded-sm bg-[#39c7ff]" />
              État plateforme
            </a>
          </nav>
        </div>

        <div className="mt-auto border-t border-[#20283a] pt-5">
          <div className="mb-3 flex items-center gap-2 px-2 text-[11px] text-[#6f7b91]">
            <span className="am-status-dot" />
            Plateforme opérationnelle
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
                <span className="max-w-48 truncate text-[#aab5c9]">
                  {item.label}
                </span>
              </span>
            ))}
          </div>
          <div className="hidden items-center gap-2 text-xs text-[#7f8a9f] sm:flex">
            <span className="am-status-dot" />
            Surveillance active
          </div>
          <div className="lg:hidden">
            <SignOutButton compact />
          </div>
        </header>
        <main className="am-content">{children}</main>
      </div>
    </div>
  );
}
