"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function WorkspaceNavLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const exact = pathname === href;
  const inSection =
    (href === "/sites" && pathname.startsWith("/organizations/")) ||
    pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={className}
      aria-current={exact ? "page" : inSection ? "location" : undefined}
    >
      {children}
    </Link>
  );
}
