import Link from "next/link";
import { requireCurrentSession } from "@/lib/current-session";
import { getUserMemberships } from "@/lib/membership-context";

export async function WorkspaceSwitcher({
  currentOrganizationId,
}: {
  currentOrganizationId?: string;
}) {
  const session = await requireCurrentSession();
  const memberships = await getUserMemberships(session.user.id);

  if (memberships.length === 0) {
    return null;
  }

  const current =
    memberships.find(
      (membership) => membership.organizationId === currentOrganizationId,
    ) ?? memberships[0]!;

  return (
    <details className="group mt-5">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg border border-[#263149] bg-[#0d121d] px-3 py-3 transition hover:border-[#3b4968] hover:bg-[#111827] [&::-webkit-details-marker]:hidden">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-[#33405a] bg-[#151c2b] font-mono text-[10px] font-semibold uppercase text-[#aeb8ca]">
          WS
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9px] uppercase tracking-[0.13em] text-[#59647a]">
            Espace
          </span>
          <span className="mt-0.5 block truncate text-sm font-medium text-[#e3e8f2]">
            {current.organizationName}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="text-xs text-[#6f7b91] transition group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="mt-2 rounded-lg border border-[#2a354d] bg-[#0b1019] p-2 shadow-2xl">
        <p className="px-2 pb-2 pt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#59647a]">
          Changer d’espace
        </p>
        <div className="space-y-1">
          {memberships.map((membership) => {
            const active = membership.organizationId === current.organizationId;
            return (
              <Link
                key={membership.organizationId}
                href={"/organizations/" + membership.organizationId}
                className={
                  "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition " +
                  (active
                    ? "bg-[#151c2b] text-white"
                    : "text-[#9aa6ba] hover:bg-[#111827] hover:text-white")
                }
              >
                <span className="truncate">{membership.organizationName}</span>
                {active ? (
                  <span className="size-1.5 rounded-sm bg-[#6d7cff]" />
                ) : null}
              </Link>
            );
          })}
        </div>

        <div className="my-2 border-t border-[#20283a]" />
        <Link
          href={"/organizations/" + current.organizationId + "#settings"}
          className="block rounded-md px-3 py-2 text-xs font-medium text-[#8d98ad] transition hover:bg-[#111827] hover:text-white"
        >
          {current.role === "member"
            ? "Ouvrir cet espace →"
            : "Gérer / renommer cet espace →"}
        </Link>
      </div>
    </details>
  );
}
