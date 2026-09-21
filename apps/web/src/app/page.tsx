const signals = [
  { label: "Sites suivis", value: "20 max.", detail: "périmètre pilote" },
  { label: "Fréquence", value: "7 jours", detail: "et scans manuels" },
  { label: "Contrôles", value: "7 familles", detail: "un seul rapport" },
];

const checks = [
  ["Disponibilité & HTTP", "Statuts, ressources et liens cassés"],
  ["TLS & en-têtes", "Expiration et configuration observable"],
  ["JavaScript", "Erreurs réellement vues dans le navigateur"],
  ["Accessibilité", "Contrôles axe-core priorisés"],
  ["Captures", "Preuve visuelle et comparaison"],
  ["Rapport de marque", "Partage client simple et lisible"],
];

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-8 lg:px-10">
      <nav className="flex items-center justify-between border-b border-white/10 pb-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-300 font-black text-emerald-950">
            A
          </span>
          <div>
            <p className="font-semibold tracking-tight">Agency Monitor</p>
            <p className="text-xs text-white/45">Nom de travail</p>
          </div>
        </div>
        <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-200">
          Pilote technique
        </span>
      </nav>

      <section className="grid gap-12 py-16 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
        <div>
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.22em] text-emerald-300">
            La maintenance qui se voit
          </p>
          <h1 className="max-w-4xl text-5xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            Détectez les problèmes avant vos clients.
          </h1>
        </div>
        <div className="space-y-6 text-lg leading-8 text-white/60">
          <p>
            Une vue multi-site pour repérer les régressions invisibles,
            documenter le travail effectué et livrer des rapports qui portent
            votre marque.
          </p>
          <div className="flex flex-wrap gap-3">
            <span className="rounded-lg bg-emerald-300 px-5 py-3 text-sm font-bold text-emerald-950">
              Premier scan bientôt disponible
            </span>
            <a
              href="/api/health"
              className="rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-white/80 transition hover:border-white/30 hover:text-white"
            >
              État de la plateforme
            </a>
          </div>
        </div>
      </section>
      <section className="grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] sm:grid-cols-3">
        {signals.map((signal) => (
          <article
            key={signal.label}
            className="border-b border-white/10 p-6 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <p className="text-sm text-white/45">{signal.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">
              {signal.value}
            </p>
            <p className="mt-1 text-sm text-emerald-200/70">{signal.detail}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-10 py-16 lg:grid-cols-[0.7fr_1.3fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/40">
            Signal utile
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">
            Moins de bruit, plus de preuves.
          </h2>
          <p className="mt-4 max-w-md leading-7 text-white/55">
            Chaque anomalie doit être actionnable, comparée au scan précédent et
            présentable à un client sans traduction technique.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {checks.map(([title, description], index) => (
            <article
              key={title}
              className="group rounded-xl border border-white/10 bg-black/10 p-5 transition hover:border-emerald-300/25 hover:bg-emerald-300/[0.04]"
            >
              <div className="flex items-start gap-4">
                <span className="mt-0.5 text-xs font-bold text-emerald-300/60">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/45">
                    {description}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="flex flex-col gap-2 border-t border-white/10 py-6 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between">
        <p>Socle pilote — aucun scan public activé.</p>
        <p>HTTP · TLS · JS · Accessibilité · Historique · Rapports</p>
      </footer>
    </main>
  );
}
