import Link from "next/link";
import { WorkspaceShell } from "@/components/product-shell";
import { getWorkspaceOverview } from "@/lib/workspace-overview";

export default async function DashboardPage() {
  const { user, sites, createSiteHref, scansInProgress, majorFindings } =
    await getWorkspaceOverview();
  const emailFallbackName = user.email.split("@")[0] ?? "";
  const displayName =
    user.name.trim() && user.name !== "Utilisateur"
      ? user.name
      : emailFallbackName || "vous";

  return (
    <WorkspaceShell trail={[{ label: "Tableau de bord" }]}>
      <section className="grid gap-8 border-b border-[#242d40] pb-9 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="am-kicker">Vue générale</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            Bonjour {displayName}
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-[#8793a8]">
            Votre activité de monitoring et les points à suivre, en un regard.
          </p>
        </div>
        {createSiteHref ? (
          <Link href={createSiteHref} className="am-button-primary">
            {sites.length === 0
              ? "Ajouter mon premier site"
              : "Ajouter un site"}
            <span aria-hidden="true">+</span>
          </Link>
        ) : null}
      </section>

      <section
        className="border-b border-[#242d40] py-7"
        aria-label="Synthèse du compte"
      >
        <div className="am-metric-grid">
          <div className="am-metric-cell">
            <p className="am-metric-label">Sites</p>
            <p className="am-metric-value">{sites.length}</p>
          </div>
          <div className="am-metric-cell">
            <p className="am-metric-label">Scans en cours</p>
            <p className="am-metric-value">{scansInProgress}</p>
          </div>
          <div className="am-metric-cell">
            <p className="am-metric-label">High / critical</p>
            <p className="am-metric-value">{majorFindings}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-8 py-9 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)] lg:items-center">
        <div>
          <p className="am-kicker">WebProbe</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em]">
            Comprendre votre site. Suivre son évolution.
          </h2>
          <p className="mt-4 max-w-2xl leading-7 text-[#8793a8]">
            Lancez un audit ponctuel d’un site public pour repérer les problèmes
            de sécurité Web et HTTP, de performance, de SEO, d’accessibilité et
            de réseau. Le rapport rassemble les constats et un plan de
            remédiation concret.
          </p>
          <p className="mt-4 max-w-2xl leading-7 text-[#8793a8]">
            Après vérification du domaine par DNS, activez le monitoring
            récurrent, comparez les scans dans le temps et recevez des alertes.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/sites" className="am-button-secondary">
              Voir mes sites →
            </Link>
            <Link href="/guide" className="am-button-secondary">
              Consulter le guide
            </Link>
          </div>
        </div>

        <div
          className="am-panel p-5 sm:p-6"
          aria-label="Aperçu illustratif d’un rapport"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[#242d40] pb-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8793a8]">
                Aperçu illustratif
              </p>
              <p className="mt-2 font-semibold">Rapport de site</p>
            </div>
            <span className="rounded-md border border-[#303a50] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#9aa6ba]">
              Audit
            </span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              { label: "Sécurité", tone: "bg-[#6d7cff]", width: "w-3/4" },
              { label: "Performance", tone: "bg-[#39c7ff]", width: "w-2/3" },
              { label: "SEO", tone: "bg-[#51d3a5]", width: "w-4/5" },
              { label: "Accessibilité", tone: "bg-[#ffb45f]", width: "w-3/5" },
            ].map((category) => (
              <div key={category.label} className="am-panel-soft p-4">
                <p className="text-xs text-[#aab5c9]">{category.label}</p>
                <div className="mt-4 h-1.5 rounded-full bg-[#242d40]">
                  <div
                    className={`h-full rounded-full ${category.tone} ${category.width}`}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="am-panel-soft mt-3 flex items-center gap-3 p-4">
            <span className="size-2 shrink-0 rounded-full bg-[#6d7cff]" />
            <p className="text-xs text-[#aab5c9]">
              Constats → actions → suivi des prochains scans
            </p>
          </div>
        </div>
      </section>
    </WorkspaceShell>
  );
}
