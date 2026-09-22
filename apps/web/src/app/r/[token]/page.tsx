import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10 lg:px-10">
      <header className="border-b border-white/10 pb-10">
        <p
          className="text-sm font-semibold uppercase tracking-[0.2em]"
          style={{ color: report.branding.accentColor }}
        >
          {report.branding.name}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Rapport — {report.site.name}
        </h1>
        <p className="mt-3 break-all text-white/45">
          {report.site.canonicalUrl}
        </p>
        <dl className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Scan terminé
            </dt>
            <dd className="mt-2 text-sm">
              {formatDate(report.scan.completedAt)}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Pages observées
            </dt>
            <dd className="mt-2 text-sm">{report.scan.pageCount}</dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Findings
            </dt>
            <dd className="mt-2 text-sm">{findings.length}</dd>
          </div>
        </dl>
      </header>

      {counts ? (
        <section className="border-b border-white/10 py-10">
          <p className="text-sm text-white/45">
            Évolution depuis le scan précédent
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Nouveaux", counts.new],
              ["Aggravés", counts.worsened],
              ["Améliorés", counts.improved],
              ["Résolus", counts.resolved],
              ["Inchangés", counts.unchanged],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                <p className="text-xs uppercase tracking-[0.12em] text-white/35">
                  {label}
                </p>
                <p className="mt-2 text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {report.screenshotAvailable ? (
        <section className="border-b border-white/10 py-10">
          <h2 className="text-xl font-semibold">Capture visuelle</h2>
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={"/r/" + encodeURIComponent(token) + "/screenshot"}
              alt={"Capture de " + report.site.name}
              className="h-auto w-full"
            />
          </div>
        </section>
      ) : null}

      <section className="py-10">
        <h2 className="text-xl font-semibold">Findings observés</h2>
        {findings.length === 0 ? (
          <p className="mt-5 text-sm text-white/50">
            Aucun finding enregistré pour ce scan.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {findings.map((finding) => (
              <article
                key={finding.fingerprint}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-white/35">
                      {finding.category}
                    </p>
                    <h3 className="mt-2 font-semibold">{finding.title}</h3>
                    {finding.pageUrl ? (
                      <p className="mt-2 break-all text-sm text-white/40">
                        {finding.pageUrl}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60">
                    {severityLabels[finding.severity]}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-white/10 py-6 text-xs text-white/30">
        Lien valable jusqu’au {formatDate(report.expiresAt)}.
      </footer>
    </main>
  );
}
