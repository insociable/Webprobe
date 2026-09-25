import Link from "next/link";
import { WorkspaceShell } from "@/components/product-shell";
import { requireCurrentSession } from "@/lib/current-session";

const steps = [
  {
    number: "01",
    title: "Ajouter un site",
    text: "Depuis Sites / Monitoring, enregistrez l’URL à observer. La création du site ne donne aucun droit supplémentaire sur la cible.",
  },
  {
    number: "02",
    title: "Lancer un Public Audit",
    text: "Le premier audit peut être lancé sans vérification DNS. Il reste passif, borné et limité aux ressources publiques autorisées.",
  },
  {
    number: "03",
    title: "Lire le rapport",
    text: "Commencez par l’état général. Les catégories qui comportent des actions conduisent directement aux remédiations correspondantes.",
  },
  {
    number: "04",
    title: "Vérifier le domaine",
    text: "Ajoutez l’enregistrement TXT demandé dans votre DNS puis lancez la vérification. Cette vérification autorise ensuite le monitoring et les audits approfondis.",
  },
  {
    number: "05",
    title: "Choisir le type de scan",
    text: "Sur un domaine vérifié, utilisez le scan standard pour le contrôle courant ou l’Audit approfondi pour une analyse bornée avec navigateur et contrôles techniques renforcés.",
  },
  {
    number: "06",
    title: "Lire Technologies & CVE",
    text: "L’Audit approfondi peut identifier passivement certaines technologies. WebProbe rapproche uniquement les produits et versions réellement observés de vulnérabilités publiques connues.",
  },
  {
    number: "07",
    title: "Activer le monitoring",
    text: "Pour le suivi récurrent, activez le scan automatique et choisissez le jour, l’heure et le fuseau horaire du planning hebdomadaire.",
  },
  {
    number: "08",
    title: "Suivre l’évolution",
    text: "Consultez l’historique repliable, les rapports successifs, les changements de constats et les alertes du monitoring vérifié.",
  },
] as const;

const vulnerabilityDefinitions = [
  {
    title: "CVE",
    text: "Identifiant public attribué à une vulnérabilité connue. Une CVE pertinente pour un produit n’implique pas automatiquement que votre site est exposé.",
  },
  {
    title: "CVSS",
    text: "Score publié avec certaines vulnérabilités pour décrire leur sévérité technique. Il aide à prioriser, mais ne remplace pas l’analyse du contexte réel.",
  },
  {
    title: "CISA KEV",
    text: "Catalogue de la CISA recensant des vulnérabilités dont l’exploitation dans la nature est documentée. La présence dans KEV augmente la priorité, sans prouver que votre site a été exploité.",
  },
  {
    title: "Confirmée ou à vérifier",
    text: "Une correspondance est confirmée seulement lorsque la version observée permet de conclure qu’elle se trouve dans une plage affectée comprise par WebProbe. Si la version est inconnue, partielle ou dépend d’un contexte supplémentaire, le résultat reste à vérifier.",
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
          Huit étapes pour passer d’une observation publique ponctuelle à un
          suivi vérifié, puis interpréter les technologies et vulnérabilités
          connues sans surévaluer ce que le scan a réellement observé.
        </p>
      </section>

      <section className="border-b border-[#242d40] py-9">
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
      </section>

      <section className="border-b border-[#242d40] py-9">
        <p className="am-kicker">Technologies &amp; vulnérabilités connues</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
          Comprendre les résultats CVE
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#8793a8]">
          L’inventaire repose sur des indices passifs comme les en-têtes HTTP,
          certaines métadonnées et ressources observées par le navigateur.
          WebProbe n’invente jamais une version absente et ne lance aucun
          exploit pour confirmer une vulnérabilité.
        </p>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {vulnerabilityDefinitions.map((item) => (
            <article
              key={item.title}
              className="rounded-lg border border-[#242d40] bg-[#0d111a] p-5"
            >
              <h3 className="font-semibold text-[#e5e9f2]">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-white/50">
                {item.text}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-6 border-l-2 border-[#46557a] bg-[#0d121d] p-5">
          <p className="text-sm leading-6 text-[#8d98ad]">
            Une version inconnue n’est jamais une vulnérabilité confirmée.
            Inversement, l’absence de CVE corrélée ne garantit pas l’absence de
            vulnérabilité : la technologie peut être inconnue, non versionnée,
            non couverte par le catalogue local ou affectée par un problème qui
            n’a pas encore été publié.
          </p>
        </div>
      </section>

      <section className="py-9">
        <div className="flex flex-wrap gap-3">
          <Link href="/sites" className="am-button-primary">
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
