import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import { getUserMemberships } from "@/lib/membership-context";
import { SignOutButton } from "@/components/sign-out-button";

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
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 lg:px-10">
      <nav className="flex items-center justify-between border-b border-white/10 pb-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-300 font-black text-emerald-950">
            A
          </span>
          <div>
            <p className="font-semibold tracking-tight">Agency Monitor</p>
            <p className="text-xs text-white/45">Espace pilote</p>
          </div>
        </Link>
        <SignOutButton />
      </nav>
      <section className="grid gap-8 py-14 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
            Session vérifiée
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">
            Bonjour {session.user.name}
          </h1>
          <p className="mt-4 max-w-xl leading-7 text-white/55">
            Votre session et vos droits d’organisation sont vérifiés côté
            serveur avant l’affichage de cet espace.
          </p>
        </div>

        <aside className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
            Compte pilote
          </p>
          <p className="mt-4 font-medium">{session.user.email}</p>
          <p className="mt-2 text-sm text-white/45">
            Authentification par code temporaire
          </p>
        </aside>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-sm text-white/45">Organisations autorisées</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Vos espaces
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {userMemberships.map((membership) => (
            <Link
              key={membership.membershipId}
              href={`/organizations/${membership.organizationId}`}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 transition hover:border-emerald-300/25 hover:bg-white/[0.055]"
            >
              <p className="text-lg font-semibold">
                {membership.organizationName}
              </p>
              <p className="mt-2 text-sm text-white/45">
                {roleLabels[membership.role]}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
