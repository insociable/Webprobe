import Link from "next/link";
import { WorkspaceShell } from "@/components/product-shell";
import { requireCurrentSession } from "@/lib/current-session";

const faq = [
  {
    question: "Pourquoi n’y a-t-il pas de mot de passe ?",
    answer:
      "Agency Monitor utilise une connexion sans mot de passe : un code OTP à usage unique est envoyé à l’adresse e-mail à chaque connexion. La sécurité du compte dépend donc aussi de celle de la messagerie utilisée ; l’activation de la MFA sur cette boîte est recommandée.",
  },
  {
    question: "Qu’est-ce qu’un Public Audit ?",
    answer:
      "Un Public Audit est un scan one-shot, passif et borné de ressources accessibles publiquement. Il respecte les limites de crawl et robots.txt et ne réalise pas de pentest actif.",
  },
  {
    question: "Quelle différence entre Public Audit et monitoring ?",
    answer:
      "Le Public Audit peut fonctionner avant vérification du domaine. Le monitoring est réservé aux domaines vérifiés et ajoute les scans récurrents, les comparaisons et les alertes associées.",
  },
  {
    question: "Pourquoi vérifier son domaine ?",
    answer:
      "La vérification DNS prouve que vous pouvez administrer le domaine avant d’autoriser le monitoring continu et le partage public des rapports. Elle n’est jamais contournée par l’interface.",
  },
  {
    question: "Comment fonctionne le score ?",
    answer:
      "Report V2 agrège plusieurs domaines techniques. Le score tient compte de la couverture réellement observée et peut être plafonné lorsque certaines analyses sont partielles ou indisponibles.",
  },
  {
    question: "Pourquoi certaines analyses sont-elles partielles ?",
    answer:
      "Une page peut être inaccessible, exclue par la politique de crawl, trop lente ou ne pas fournir un signal exploitable. Le rapport indique la couverture plutôt que d’inventer une mesure manquante.",
  },
  {
    question: "Que signifient les priorités ?",
    answer:
      "Les priorités regroupent les problèmes distincts selon leur niveau d’action, leur sévérité, la couverture et leur récurrence. Elles servent à ordonner le plan de remédiation.",
  },
  {
    question: "Comment exporter un rapport en PDF ?",
    answer:
      "Ouvrez un rapport terminé puis utilisez le bouton d’impression. L’impression locale permet d’enregistrer un PDF, y compris pour un Public Audit non vérifié.",
  },
  {
    question: "Quand les scans sont-ils relancés ?",
    answer:
      "Un scan peut être lancé manuellement. Sur un domaine vérifié, un responsable peut aussi activer le planning hebdomadaire et choisir son créneau.",
  },
  {
    question:
      "Pourquoi un Public Audit non vérifié ne peut-il pas être partagé ?",
    answer:
      "Tant que le domaine n’est pas vérifié, le rapport reste privé dans votre espace : aucun lien public, token de partage ou envoi public n’est autorisé.",
  },
] as const;

export default async function HelpPage() {
  await requireCurrentSession();

  return (
    <WorkspaceShell trail={[{ label: "FAQ / Aide" }]}>
      <section className="border-b border-[#242d40] pb-9">
        <p className="am-kicker">Aide</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em]">
          Comprendre Agency Monitor
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-[#8793a8]">
          Les réponses ci-dessous décrivent le fonctionnement actuel du produit,
          notamment la frontière entre audit public et monitoring vérifié.
        </p>
        <Link href="/guide" className="am-button-secondary mt-6">
          Voir le guide utilisateur →
        </Link>
      </section>

      <section className="py-9">
        <div className="space-y-3">
          {faq.map((item) => (
            <details
              key={item.question}
              className="group rounded-lg border border-[#242d40] bg-[#0d111a]"
            >
              <summary className="cursor-pointer list-none px-5 py-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8793ff]">
                <span className="flex items-center justify-between gap-4">
                  {item.question}
                  <span
                    aria-hidden="true"
                    className="text-[#7685ff] transition group-open:rotate-180"
                  >
                    ↓
                  </span>
                </span>
              </summary>
              <p className="border-t border-[#242d40] px-5 py-4 text-sm leading-6 text-white/55">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </section>
    </WorkspaceShell>
  );
}
