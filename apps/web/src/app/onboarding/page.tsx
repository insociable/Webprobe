import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import { getUserMemberships } from "@/lib/membership-context";
import { SignOutButton } from "@/components/sign-out-button";

export default async function OnboardingPage() {
  const session = await requireCurrentSession();
  const userMemberships = await getUserMemberships(session.user.id);

  if (userMemberships.length > 0) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-8 lg:px-10">
      <nav className="flex items-center justify-between border-b border-white/10 pb-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-300 font-black text-emerald-950">
            A
          </span>
          <div>
            <p className="font-semibold tracking-tight">Agency Monitor</p>
            <p className="text-xs text-white/45">Configuration initiale</p>
          </div>
        </Link>
        <SignOutButton />
      </nav>
      <section className="py-14">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
          Compte vérifié
        </p>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight">
          Configurez votre première agence.
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-white/55">
          Votre compte {session.user.email} est authentifié, mais il n’est
          encore rattaché à aucune organisation. Cet écran devient donc le seul
          point d’entrée autorisé avant la création de votre espace agence.
        </p>

        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.035] p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
            Prochaine étape
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Créer l’organisation et attribuer le rôle propriétaire
          </h2>
          <p className="mt-3 max-w-2xl leading-7 text-white/50">
            La création sera effectuée en une seule transaction : organisation
            puis membership propriétaire pour votre utilisateur courant.
          </p>
        </div>
      </section>
    </main>
  );
}
