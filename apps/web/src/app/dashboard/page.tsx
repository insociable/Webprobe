import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
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
            Votre espace est protégé par une session validée côté serveur.
            L’étape suivante reliera ici vos organisations et leurs sites.
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

      <section className="rounded-2xl border border-dashed border-white/15 bg-black/10 p-8">
        <p className="text-sm text-white/45">
          Aucune organisation affichée ici pour le moment.
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          La couche organisation / sites arrive ensuite.
        </h2>
      </section>
    </main>
  );
}
