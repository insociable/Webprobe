import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/product-shell";
import { requireCurrentSession } from "@/lib/current-session";
import { getUserMemberships } from "@/lib/membership-context";

const roleLabels = {
  owner: "Propriétaire",
  admin: "Administrateur",
  member: "Membre",
} as const;

export default async function DashboardPage() {
  const session = await requireCurrentSession();
  const userMemberships = await getUserMemberships(session.user.id);

  if (userMemberships.length === 0) {
    redirect("/onboarding");
  }

  return (
    <WorkspaceShell>
      <section className="grid gap-8 border-b border-[#242d40] pb-9 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="am-kicker">Vue générale</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            Bonjour {session.user.name}
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-[#8793a8]">
            Choisissez une organisation pour retrouver ses sites, les scans
            actifs et les rapports à traiter.
          </p>
        </div>
        <div className="text-left lg:text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#5f6b81]">
            Session
          </p>
          <p className="mt-2 text-sm text-[#b7c0d1]">{session.user.email}</p>
        </div>
      </section>

      <section className="py-9">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
              Organisations autorisées
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              Vos espaces
            </h2>
          </div>
          <span className="font-mono text-xs text-[#657188]">
            {String(userMemberships.length).padStart(2, "0")}
          </span>
        </div>

        <div className="mt-6 overflow-hidden border-y border-[#242d40]">
          {userMemberships.map((membership, index) => (
            <Link
              key={membership.membershipId}
              href={"/organizations/" + membership.organizationId}
              className="group grid gap-4 border-b border-[#242d40] px-1 py-5 transition last:border-b-0 hover:bg-[#0d121d] sm:grid-cols-[48px_1fr_180px_auto] sm:items-center sm:px-4"
            >
              <span className="font-mono text-xs text-[#56627a]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="font-semibold text-[#e9edf6] transition group-hover:text-white">
                  {membership.organizationName}
                </p>
                <p className="mt-1 text-sm text-[#6f7b91]">
                  Ouvrir le parc de sites
                </p>
              </div>
              <span className="text-sm text-[#8f9aaf]">
                {roleLabels[membership.role]}
              </span>
              <span className="text-[#6d7cff] transition group-hover:translate-x-1">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </WorkspaceShell>
  );
}
