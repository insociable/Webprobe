import {
  OrganizationReadSchema,
  ScanResultSchema,
  SiteReadSchema,
} from "@agency-saas/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import { getScanDetailsForSite } from "@/lib/scan-history";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import { ScanStatusRefresher } from "../../scan-status-refresher";

type ScanPageProps = {
  params: Promise<{
    organizationId: string;
    siteId: string;
    scanId: string;
  }>;
};

const scanStatusLabels = {
  queued: "En file",
  running: "En cours",
  completed: "Terminé",
  failed: "Échec",
  cancelled: "Annulé",
} as const;

const severityLabels = {
  info: "Info",
  low: "Faible",
  medium: "Moyenne",
  high: "Haute",
  critical: "Critique",
} as const;

const severityRank = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
} as const;

function formatDate(value: Date | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris",
  }).format(value);
}

function visibleEvidence(
  evidence: Record<string, unknown>,
): Array<[string, string]> {
  const labels: Record<string, string> = {
    statusCode: "Statut HTTP",
    durationMs: "Durée HTTP (ms)",
    header: "En-tête",
    errorCode: "Code erreur",
    remainingDays: "Jours restants",
    validTo: "Expiration TLS",
    protocol: "Protocole TLS",
    value: "Valeur observée",
    kind: "Type",
  };

  return Object.entries(labels).flatMap(([key, label]) => {
    const value = evidence[key];
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      return [];
    }

    return [[label, String(value)]];
  });
}

async function loadScan(
  userId: string,
  organizationId: string,
  siteId: string,
  scanId: string,
) {
  try {
    return await getScanDetailsForSite(userId, organizationId, siteId, scanId);
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      notFound();
    }
    throw error;
  }
}

export default async function ScanPage({ params }: ScanPageProps) {
  const { organizationId, siteId, scanId } = await params;

  if (
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success ||
    !SiteReadSchema.shape.id.safeParse(siteId).success ||
    !ScanResultSchema.shape.scanId.safeParse(scanId).success
  ) {
    notFound();
  }

  const session = await requireCurrentSession();
  const details = await loadScan(
    session.user.id,
    organizationId,
    siteId,
    scanId,
  );

  if (!details) {
    notFound();
  }

  const pending =
    details.scan.status === "queued" || details.scan.status === "running";
  const orderedFindings = [...details.findings].sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity],
  );

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 lg:px-10">
      <ScanStatusRefresher active={pending} />

      <Link
        href={`/organizations/${organizationId}/sites/${siteId}`}
        className="text-sm text-white/45 transition hover:text-white/70"
      >
        ← Retour à {details.site.name}
      </Link>

      <section className="border-b border-white/10 py-10">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Résultat du scan
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {details.site.name}
            </h1>
            <p className="mt-3 break-all text-white/45">
              {details.site.canonicalUrl}
            </p>
          </div>
          <span className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/60">
            {scanStatusLabels[details.scan.status]}
          </span>
        </div>

        <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Déclenchement
            </dt>
            <dd className="mt-2 text-sm">
              {details.scan.trigger === "manual" ? "Manuel" : "Planifié"}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Mis en file
            </dt>
            <dd className="mt-2 text-sm">
              {formatDate(details.scan.queuedAt)}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Terminé
            </dt>
            <dd className="mt-2 text-sm">
              {formatDate(details.scan.completedAt)}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-[0.15em] text-white/35">
              Pages observées
            </dt>
            <dd className="mt-2 text-sm">{details.scan.pageCount}</dd>
          </div>
        </dl>

        {pending ? (
          <p className="mt-6 text-sm text-white/50">
            Le scan est encore en cours. Cette page se rafraîchit
            automatiquement.
          </p>
        ) : null}
      </section>

      <section className="py-10">
        <p className="text-sm text-white/45">Analyse</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          {orderedFindings.length} finding
          {orderedFindings.length > 1 ? "s" : ""}
        </h2>

        {orderedFindings.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-black/10 p-8">
            <p className="text-white/50">
              Aucun finding enregistré pour ce scan.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {orderedFindings.map((finding) => {
              const evidence = visibleEvidence(finding.evidence);
              return (
                <article
                  key={finding.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.035] p-6"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-white/35">
                        {finding.category} · {finding.code}
                      </p>
                      <h3 className="mt-2 text-lg font-semibold">
                        {finding.title}
                      </h3>
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

                  {evidence.length > 0 ? (
                    <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {evidence.map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-lg bg-black/15 px-4 py-3"
                        >
                          <dt className="text-xs text-white/35">{label}</dt>
                          <dd className="mt-1 break-all text-sm text-white/70">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
