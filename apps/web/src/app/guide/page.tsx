import Link from "next/link";
import { WorkspaceShell } from "@/components/product-shell";
import { requireCurrentSession } from "@/lib/current-session";

const steps = [
  {
    number: "01",
    title: "Ajouter un site",
    text: "Depuis le tableau de bord, enregistrez l’URL à observer. La création du site ne donne aucun droit supplémentaire sur la cible.",
  },
  {
    number: "02",
    title: "Lancer un Public Audit",
    text: "Le premier audit peut être lancé sans vérification DNS. Il reste passif, borné et limité aux ressources publiques autorisées.",
  },
  {
    number: "03",
    title: "Lire le rapport",
    text: "Commencez par l’état général. Les catégories qui comportent des actions sont cliquables et conduisent directement aux remédiations correspondantes.",
  },
  {
    number: "04",
    title: "Vérifier le domaine",
    text: "Ajoutez l’enregistrement TXT demandé dans votre DNS puis lancez la vérification. Cette étape est obligatoire avant le monitoring continu.",
  },
  {
    number: "05",
    title: "Activer le monitoring",
    text: "Une fois le domaine vérifié, activez le scan automatique et choisissez le jour, l’heure et le fuseau horaire du planning hebdomadaire.",
  },
  {
    number: "06",
    title: "Suivre l’évolution",
    text: "Consultez l’historique repliable, les rapports successifs, les changements de findings et les alertes du monitoring vérifié.",
  },
] as const;

export default async function GuidePage() {
  await requireCurrentSession();

  return (
    <WorkspaceShell trail={[{ label: "Guide" }]}>
      <section className="border-b border-[#242d40] pb-9">
        <p className="am-kicker">Guide utilisateur</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em]">
          Du premier audit au suivi continu
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-[#8793a8]">
          Six étapes suffisent pour passer d’une observation publique ponctuelle
          à un monitoring vérifié et récurrent.
        </p>
      </section>

      <section className="py-9">
        <ol className="grid gap-4 lg:grid-cols-2">
          {steps.map((step) => (
            <li
              key={step.number}
              className="rounded-lg border border-[#242d40] bg-[#0d111a] p-6"
            >
              <span className="font-mono text-xs font-semibold text-[#8793ff]">
                {step.number}
              </span>
              <h2 className="mt-3 text-xl font-semibold">{step.title}</h2>
              <p className="mt-3 text-sm leading-6 text-white/50">
                {step.text}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard#sites" className="am-button-primary">
            Ouvrir mes sites →
          </Link>
          <Link href="/help" className="am-button-secondary">
            Consulter la FAQ
          </Link>
        </div>
      </section>
    </WorkspaceShell>
  );
}
