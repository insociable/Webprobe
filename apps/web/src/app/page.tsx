import Link from "next/link";
import { ProductMark } from "@/components/product-mark";

const signals = [
  { label: "Sites suivis", value: "20 max.", detail: "périmètre pilote" },
  { label: "Cadence", value: "7 jours", detail: "+ scans manuels" },
  { label: "Contrôles", value: "7 familles", detail: "dans un même rapport" },
];

const checks = [
  ["Disponibilité", "HTTP, ressources, redirections et liens cassés"],
  ["Surface web", "TLS, CSP, HSTS et en-têtes de sécurité"],
  ["Navigateur", "Erreurs JavaScript et rendu réellement observé"],
  ["Accessibilité", "Contrôles axe-core et défauts priorisés"],
  ["Historique", "Comparaison avec le scan précédent et rétablissements"],
  ["Rapport client", "Preuves, remédiations et partage à votre marque"],
];

export default function Home() {
  return (
    <main className="min-h-screen">
      <nav className="mx-auto flex w-[min(1240px,calc(100%-32px))] items-center justify-between border-b border-[#242d40] py-5">
        <ProductMark />
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#718097] sm:flex">
            <span className="am-status-dot" />
            Pilote opérationnel
          </span>
          <Link href="/sign-in" className="am-button-secondary">
            Connexion
          </Link>
        </div>
      </nav>

      <section className="mx-auto grid w-[min(1240px,calc(100%-32px))] gap-12 py-16 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:py-24">
        <div>
          <p className="am-kicker">Surveillance multi-site pour agences</p>
          <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-[0.96] tracking-[-0.055em] text-[#f7f9ff] sm:text-6xl lg:text-[4.9rem]">
            Voyez ce qui change.
            <span className="block text-[#7f8cff]">
              Agissez avant le client.
            </span>
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-[#97a2b7]">
            Agency Monitor transforme chaque scan en signal exploitable : état
            du site, dérives, preuves, remédiations et rapport partageable.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-in" className="am-button-primary">
              Accéder au pilote
              <span aria-hidden="true">→</span>
            </Link>
            <a href="/api/health" className="am-button-secondary">
              Vérifier la plateforme
            </a>
          </div>
        </div>

        <div className="am-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#242d40] px-5 py-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#68758c]">
                Dernier signal
              </p>
              <p className="mt-1 font-semibold">client.example.fr</p>
            </div>
            <span className="rounded-md border border-[#31435a] bg-[#0a1720] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#68d7ff]">
              Scan terminé
            </span>
          </div>
          <div className="grid border-b border-[#242d40] sm:grid-cols-4">
            {[
              ["HTTP", "200", "#51d3a5"],
              ["Pages", "16", "#dfe5f2"],
              ["Findings", "08", "#ffb45f"],
              ["Critical", "00", "#dfe5f2"],
            ].map(([label, value, color]) => (
              <div
                key={label}
                className="border-b border-[#242d40] px-4 py-5 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#66738a]">
                  {label}
                </p>
                <p className="mt-2 text-2xl font-semibold" style={{ color }}>
                  {value}
                </p>
              </div>
            ))}
          </div>
          <div className="space-y-1 p-3">
            {[
              ["CSP absente", "Medium", "Nouveau"],
              ["Contraste insuffisant", "Medium", "Stable"],
              ["Heading order", "Low", "Nouveau"],
              ["Certificat à surveiller", "Low", "Stable"],
            ].map(([title, severity, state], index) => (
              <div
                key={title}
                className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-md border border-transparent px-3 py-3 hover:border-[#283248] hover:bg-[#101621]"
              >
                <span className="font-mono text-xs text-[#536079]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-sm font-medium text-[#e2e7f2]">{title}</p>
                  <p className="mt-1 text-xs text-[#657188]">{state}</p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#a7b1c5]">
                  {severity}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-[min(1240px,calc(100%-32px))] pb-16">
        <div className="am-metric-grid">
          {signals.map((signal) => (
            <article key={signal.label} className="am-metric-cell">
              <p className="am-metric-label">{signal.label}</p>
              <p className="am-metric-value">{signal.value}</p>
              <p className="mt-1 text-sm text-[#748097]">{signal.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid w-[min(1240px,calc(100%-32px))] gap-10 border-t border-[#242d40] py-16 lg:grid-cols-[0.72fr_1.28fr]">
        <div>
          <p className="am-kicker">Du signal à la correction</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em]">
            Un cockpit, pas une collection de voyants.
          </h2>
          <p className="mt-4 max-w-md leading-7 text-[#8793a8]">
            Le parcours reste linéaire : choisir un site, lancer ou suivre un
            scan, comprendre le résultat, corriger puis partager.
          </p>
        </div>
        <div className="divide-y divide-[#242d40] border-y border-[#242d40]">
          {checks.map(([title, description], index) => (
            <article
              key={title}
              className="grid gap-3 py-4 sm:grid-cols-[48px_180px_1fr] sm:items-center"
            >
              <span className="font-mono text-xs text-[#56627a]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="font-semibold text-[#e8ecf5]">{title}</h3>
              <p className="text-sm leading-6 text-[#7f8a9f]">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="mx-auto flex w-[min(1240px,calc(100%-32px))] flex-col gap-2 border-t border-[#242d40] py-6 font-mono text-[10px] uppercase tracking-[0.1em] text-[#556176] sm:flex-row sm:items-center sm:justify-between">
        <p>Agency Monitor — pilote technique</p>
        <p>HTTP · TLS · JS · A11Y · Historique · Rapports</p>
      </footer>
    </main>
  );
}
