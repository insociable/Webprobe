import {
  getFindingBusinessContext,
  getFindingDisplayTitle,
  type ReportFindingLike,
} from "@/lib/report-presentation";
import { getFindingRemediation } from "@/lib/finding-remediation";

type ActionPlanGroup = {
  key: string;
  primary: ReportFindingLike;
  occurrenceCount: number;
  pageUrls: string[];
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

export function ReportActionPlan({
  groups,
}: {
  groups: readonly ActionPlanGroup[];
}) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="report-action-plan border-b border-[#242d40] py-10">
      <p className="am-kicker">Plan d’action</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
        Feuille de route de remédiation
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">
        Une ligne par problème distinct. L’objectif est de donner un ordre de
        travail exploitable sans répéter le même défaut pour chaque page.
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-[#242d40]">
        {groups.map((group, index) => {
          const finding = group.primary;
          const businessContext = getFindingBusinessContext(finding);
          const remediation = getFindingRemediation(finding.code);

          return (
            <article
              key={group.key}
              className="report-action-row grid gap-4 border-b border-[#242d40] bg-[#0d111a] p-5 last:border-b-0 lg:grid-cols-[42px_minmax(0,2fr)_minmax(0,1fr)_140px]"
            >
              <span className="font-mono text-xs text-[#56627a]">
                {String(index + 1).padStart(2, "0")}
              </span>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-severity={finding.severity}
                    className={
                      "rounded-md border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] " +
                      severityStyles[finding.severity]
                    }
                  >
                    {severityLabels[finding.severity]}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/30">
                    {finding.code}
                  </span>
                </div>
                <h3 className="mt-2 font-semibold">
                  {getFindingDisplayTitle(finding)}
                </h3>
                <p className="mt-2 text-xs leading-5 text-white/40">
                  {group.occurrenceCount} occurrence
                  {group.occurrenceCount > 1 ? "s" : ""} ·{" "}
                  {group.pageUrls.length} page
                  {group.pageUrls.length > 1 ? "s" : ""} / ressource
                  {group.pageUrls.length > 1 ? "s" : ""}
                </p>
              </div>

              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/30">
                  Action recommandée
                </p>
                <p className="mt-2 text-sm leading-5 text-white/65">
                  {remediation?.title ?? "Diagnostic technique ciblé"}
                </p>
                <p className="mt-2 text-xs text-white/40">
                  {businessContext.intervention}
                </p>
              </div>

              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/30">
                  Effort
                </p>
                <p className="mt-2 text-sm font-semibold text-white/70">
                  {businessContext.effort}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
