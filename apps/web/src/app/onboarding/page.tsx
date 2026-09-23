import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/product-shell";
import { requireCurrentSession } from "@/lib/current-session";
import { getUserMemberships } from "@/lib/membership-context";
import { OrganizationForm } from "./organization-form";

export default async function OnboardingPage() {
  const session = await requireCurrentSession();
  const userMemberships = await getUserMemberships(session.user.id);

  if (userMemberships.length > 0) {
    redirect("/dashboard");
  }

  const emailFallbackName = session.user.email.split("@")[0] ?? "";
  const initialDisplayName =
    session.user.name.trim().toLowerCase() ===
      emailFallbackName.trim().toLowerCase() ||
    session.user.name === "Utilisateur"
      ? ""
      : session.user.name;

  return (
    <WorkspaceShell trail={[{ label: "Configuration initiale" }]}>
      <section className="max-w-3xl">
        <p className="am-kicker">Première mise en route</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
          Finalisez votre profil.
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-[#8793a8]">
          Le compte <span className="text-[#c5cedd]">{session.user.email}</span>{" "}
          est vérifié. Choisissez simplement le nom affiché dans votre portail.
          Vous pourrez ensuite ajouter votre premier site.
        </p>
      </section>

      <section className="am-panel mt-10 max-w-3xl p-6 sm:p-8">
        <div className="grid gap-6 sm:grid-cols-[150px_1fr]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#627087]">
              Étape 01 / 01
            </p>
            <div className="mt-4 h-px w-12 bg-[#6d7cff]" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em]">
              Votre identité
            </h2>
            <p className="mt-3 leading-7 text-[#7f8a9f]">
              Ce nom sera utilisé dans l’interface. Vous pourrez ensuite ajouter
              votre premier site et lancer immédiatement un audit public, sans
              vérification DNS.
            </p>
            <OrganizationForm initialDisplayName={initialDisplayName} />
          </div>
        </div>
      </section>
    </WorkspaceShell>
  );
}
