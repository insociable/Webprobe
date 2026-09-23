import type {
  ReportCategoryScore,
  ReportScoreCategoryKey,
  ReportScoreCoverage,
  ReportScorecard,
} from "@/lib/report-score";

const gradeStyles = {
  A: "border-emerald-400/35 bg-emerald-400/[0.08] text-emerald-200",
  B: "border-cyan-400/35 bg-cyan-400/[0.08] text-cyan-100",
  C: "border-amber-300/35 bg-amber-300/[0.08] text-amber-100",
  D: "border-orange-400/35 bg-orange-400/[0.08] text-orange-100",
  E: "border-rose-400/35 bg-rose-400/[0.08] text-rose-100",
} as const;

const coverageLabels = {
  complete: "Complète",
  partial: "Partielle",
  unavailable: "Non évaluée",
} as const;

function coverageDetail(coverage: ReportScoreCoverage): string {
  const label = coverageLabels[coverage.status];

  if (
    coverage.status === "partial" &&
    coverage.observedCount !== undefined &&
    coverage.eligibleCount !== undefined
  ) {
    return (
      label +
      " · " +
      coverage.observedCount +
      "/" +
      coverage.eligibleCount +
      " pages"
    );
  }

  return label;
}

function CategoryRow({
  category,
  targetId,
}: {
  category: ReportCategoryScore;
  targetId?: string;
}) {
  const content = (
    <>
      <div>
        <p className="font-medium text-[#dfe5f2]">{category.label}</p>
        <p className="mt-1 text-xs text-[#69758b]">
          {coverageDetail(category.coverage)}
        </p>
        {targetId ? (
          <p className="mt-1 text-xs font-medium text-[#8793ff]">
            Voir les actions ↓
          </p>
        ) : null}
      </div>

      <div className="text-xs text-[#7f8a9f]">
        {category.distinctFindingCount > 0
          ? category.distinctFindingCount +
            " problème" +
            (category.distinctFindingCount > 1 ? "s" : "") +
            " distinct" +
            (category.distinctFindingCount > 1 ? "s" : "")
          : category.score === null
            ? "Contrôle non effectué"
            : "Aucun problème détecté"}
      </div>

      <div className="sm:text-center">
        {category.grade ? (
          <span
            data-grade={category.grade}
            className={
              "inline-flex size-9 items-center justify-center rounded-md border text-sm font-bold " +
              gradeStyles[category.grade]
            }
          >
            {category.grade}
          </span>
        ) : (
          <span className="font-mono text-xs text-[#56627a]">—</span>
        )}
      </div>

      <div className="sm:text-right">
        {category.score !== null ? (
          <>
            <span className="text-lg font-semibold text-[#e9edf6]">
              {category.score}
            </span>
            <span className="text-xs text-[#59647a]"> / 100</span>
          </>
        ) : (
          <span className="text-sm font-medium text-[#657188]">Non évalué</span>
        )}
      </div>
    </>
  );

  const className =
    "grid gap-3 border-b border-[#242d40] py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_150px_54px_86px] sm:items-center";

  if (!targetId) {
    return <div className={className}>{content}</div>;
  }

  return (
    <a
      href={"#" + targetId}
      className={
        className +
        " -mx-3 rounded-md px-3 transition hover:bg-[#111827] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8793ff]"
      }
      aria-label={"Voir les remédiations pour " + category.label}
    >
      {content}
    </a>
  );
}

export function ReportScorecard({
  scorecard,
  distinctProblems,
  occurrences,
  pageCount,
  categoryTargets = {},
}: {
  scorecard: ReportScorecard;
  distinctProblems: number;
  occurrences: number;
  pageCount: number;
  categoryTargets?: Partial<Record<ReportScoreCategoryKey, string>>;
}) {
  return (
    <section className="report-v2-scorecard border-b border-[#242d40] py-10">
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-lg border border-[#2a3550] bg-[#0d121d] p-6">
          <p className="am-kicker">Agency Monitor Report</p>
          <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#647188]">
            Score du site
          </p>

          <div className="mt-3 flex items-end gap-3">
            {scorecard.score !== null ? (
              <>
                <span className="text-5xl font-semibold tracking-[-0.05em] text-white">
                  {scorecard.score}
                </span>
                <span className="pb-1 text-sm text-[#657188]">/ 100</span>
              </>
            ) : (
              <span className="text-2xl font-semibold text-[#7b879c]">
                Non évalué
              </span>
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            {scorecard.grade ? (
              <span
                data-grade={scorecard.grade}
                className={
                  "inline-flex size-11 items-center justify-center rounded-md border text-lg font-bold " +
                  gradeStyles[scorecard.grade]
                }
              >
                {scorecard.grade}
              </span>
            ) : null}
            <div>
              <p className="text-sm font-medium text-[#d9dfeb]">
                {scorecard.coverage === "complete"
                  ? "Analyse complète"
                  : scorecard.coverage === "partial"
                    ? "Analyse partielle"
                    : "Analyse non disponible"}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#647188]">
                {scorecard.evaluatedWeight}% du modèle de score évalué
              </p>
            </div>
          </div>

          {scorecard.coverageCap !== null &&
          scorecard.coverageCap < 100 &&
          scorecard.rawScore !== null &&
          scorecard.rawScore > scorecard.coverageCap ? (
            <p className="mt-5 border-t border-[#242d40] pt-4 text-xs leading-5 text-[#7f8a9f]">
              Score plafonné à {scorecard.coverageCap}/100 car certaines
              analyses sont partielles ou indisponibles.
            </p>
          ) : null}

          <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-[#242d40] pt-5">
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#56627a]">
                Problèmes
              </dt>
              <dd className="mt-1 text-lg font-semibold">{distinctProblems}</dd>
            </div>
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#56627a]">
                Occurrences
              </dt>
              <dd className="mt-1 text-lg font-semibold">{occurrences}</dd>
            </div>
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#56627a]">
                Pages
              </dt>
              <dd className="mt-1 text-lg font-semibold">{pageCount}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-[#242d40] bg-[#0a0f18] px-5">
          <div className="flex items-end justify-between gap-4 border-b border-[#242d40] py-5">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#647188]">
                Scores par domaine
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em]">
                État général
              </h2>
            </div>
            <span className="text-xs text-[#59647a]">
              Report V2 · {scorecard.version}
            </span>
          </div>

          {scorecard.categories.map((category) => (
            <CategoryRow
              key={category.key}
              category={category}
              targetId={categoryTargets[category.key]}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
