import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductMark } from "@/components/product-shell";
import { getFindingRemediation } from "@/lib/finding-remediation";
import { getPublicReportByToken } from "@/lib/public-report-service";

export const metadata: Metadata = {
  title: "Rapport de surveillance",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type PublicReportPageProps = {
  params: Promise<{ token: string }>;
};

const severityLabels = {
  info: "Info",
  low: "Faible",
  medium: "Moyenne",
  high: "Haute",
  critical: "Critique",
} as const;

const severityStyles = {
  info: "border-[#33405a] bg-[#111827] text-[#aeb9cc]",
  low: "border-[#39455c] bg-[#121722] text-[#c0c8d7]",
  medium: "border-[#7b5b32] bg-[#21180f] text-[#ffc47f]",
  high: "border-[#7a3f49] bg-[#251217] text-[#ff8e9d]",
  critical: "border-[#a44355] bg-[#301017] text-[#ff7185]",
} as const;

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(value);
}

export default async function PublicReportPage({
  params,
}: PublicReportPageProps) {
  const { token } = await params;
  const report = await getPublicReportByToken(token);
  if (!report) {
    notFound();
  }

  const counts = report.comparison?.counts;
  const rank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  const findings = [...report.scan.findings].sort(
    (a, b) => rank[b.severity] - rank[a.severity],
  );

  return (
    <main className="min-h-screen">
      <header className="border-b border-[#242d40] bg-[#090c13]/90">
        <div className="mx-auto flex w-[min(1120px,calc(100%-32px))] items-center justify-between py-5">
          <ProductMark />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
            Rapport partagé · lecture seule
          </span>
        </div>
      </header>

      <div className="mx-auto w-[min(1120px,calc(100%-32px))] py-10 lg:py-14">
        <section className="grid gap-8 border-b border-[#242d40] pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p
              className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: report.branding.accentColor }}
            >
              {report.branding.name}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              Rapport — {report.site.name}
            </h1>
            <p className="mt-3 break-all text-[#7f8a9f]">
              {report.site.canonicalUrl}
            </p>
          </div>
          <div className="lg:text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#627087]">
              Scan terminé
            </p>
            <p className="mt-2 text-sm text-[#c3cbd9]">
              {formatDate(report.scan.completedAt)}
            </p>
          </div>
        </section>

        <section className="py-8">
          <div className="am-metric-grid">
            <div className="am-metric-cell">
              <p className="am-metric-label">Pages observées</p>
              <p className="am-metric-value">{report.scan.pageCount}</p>
            </div>
            <div className="am-metric-cell">
              <p className="am-metric-label">Findings</p>
              <p className="am-metric-value">{findings.length}</p>
            </div>
            <div className="am-metric-cell">
              <p className="am-metric-label">Lien valable jusqu’au</p>
              <p className="mt-2 text-sm font-medium text-[#d5dbe7]">
                {formatDate(report.expiresAt)}
              </p>
            </div>
          </div>
        </section>

        {counts ? (
          <section className="border-t border-[#242d40] py-9">
            <p className="am-kicker">Évolution</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
              Depuis le scan précédent
            </h2>
            <div className="mt-6 grid overflow-hidden border border-[#242d40] sm:grid-cols-5">
              {[
                ["Nouveaux", counts.new],
                ["Aggravés", counts.worsened],
                ["Améliorés", counts.improved],
                ["Résolus", counts.resolved],
                ["Inchangés", counts.unchanged],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="border-b border-[#242d40] p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#647188]">
                    {label}
                  </p>
                  <p className="mt-2 text-xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {report.screenshotAvailable ? (
          <section className="border-t border-[#242d40] py-9">
            <p className="am-kicker">Preuve visuelle</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
              Page principale au moment du scan
            </h2>
            <div className="mt-6 overflow-hidden rounded-lg border border-[#242d40] bg-[#080b12]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={"/r/" + encodeURIComponent(token) + "/screenshot"}
                alt={"Capture de " + report.site.name}
                className="h-auto w-full"
              />
            </div>
          </section>
        ) : null}

        <section className="border-t border-[#242d40] py-9">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="am-kicker">Analyse</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                Findings observés
              </h2>
            </div>
            <span className="font-mono text-xs text-[#657188]">
              {String(findings.length).padStart(2, "0")}
            </span>
          </div>

          {findings.length === 0 ? (
            <div className="mt-6 border-l-2 border-[#51d3a5] bg-[#0d1715] p-6 text-[#a9cabb]">
              Aucun finding enregistré pour ce scan.
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {findings.map((finding, index) => {
                const remediation = getFindingRemediation(finding.code);
                return (
                  <article
                    key={finding.fingerprint}
                    className="border border-[#242d40] bg-[#0d111a] p-5 sm:p-6"
                  >
                    <div className="grid gap-4 sm:grid-cols-[42px_1fr_auto]">
                      <span className="font-mono text-xs text-[#56627a]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#647188]">
                          {finding.category}
                        </p>
                        <h3 className="mt-2 font-semibold">{finding.title}</h3>
                        {finding.pageUrl ? (
                          <p className="mt-2 break-all text-sm text-[#6f7b91]">
                            {finding.pageUrl}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={
                          "h-fit rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] " +
                          severityStyles[finding.severity]
                        }
                      >
                        {severityLabels[finding.severity]}
                      </span>
                    </div>

                    {remediation ? (
                      <div className="mt-5 border-l-2 border-[#6d7cff] bg-[#0f1421] p-5">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8793ff]">
                          Comment corriger
                        </p>
                        <h4 className="mt-2 font-semibold text-[#eef1ff]">
                          {remediation.title}
                        </h4>
                        <p className="mt-2 text-sm leading-6 text-[#8f9aaf]">
                          {remediation.summary}
                        </p>
                        <ol className="mt-4 space-y-2 text-sm leading-6 text-[#aeb7c8]">
                          {remediation.steps.map((step, stepIndex) => (
                            <li key={step} className="flex gap-3">
                              <span className="font-mono text-[#7f8cff]">
                                {stepIndex + 1}.
                              </span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className="border-t border-[#242d40] py-6 font-mono text-[10px] uppercase tracking-[0.1em] text-[#556176]">
          Rapport généré par Agency Monitor · lien de partage sécurisé
        </footer>
      </div>
    </main>
  );
}
