export type DeepRunData = {
  checkId: string;
  status: string;
  evidence: ReadonlyArray<Record<string, unknown>>;
};

export type DeepFinding = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function observedPageCount(
  scanMode: string,
  persistedPageCount: number,
  runs: readonly DeepRunData[],
): number | null {
  if (scanMode !== "verified_deep_audit") return persistedPageCount;
  const browser = runs.find(
    (run) =>
      run.checkId === "deep-browser-observation" && run.status === "completed",
  );
  for (const item of browser?.evidence ?? []) {
    const count = record(item.data)?.pageCount;
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0)
      return count;
  }
  // The standard-scan column is not updated by Deep. Without browser evidence,
  // a stored zero cannot distinguish "none observed" from "not observed".
  return null;
}

const absentCspFinding: DeepFinding = {
  code: "csp-absent",
  level: "review",
  summary: "Aucune CSP appliquée n'a été observée.",
  recommendation:
    "Définir une politique adaptée, la valider en mode rapport puis l'appliquer.",
};

// Historical Deep runs predate the dedicated CSP finding. Normalize only their
// presentation so that old reports and new reports tell the same story.
export function deepFindings(
  run: DeepRunData,
  dedicatedCspCompleted: boolean,
  httpObservationFailed = false,
): DeepFinding[] {
  if (run.status !== "completed") return [];
  const data = record(run.evidence[0]?.data);
  const findings = Array.isArray(data?.findings)
    ? data.findings
        .map(record)
        .filter((item): item is DeepFinding => item !== null)
    : [];
  if (run.checkId === "deep-security-headers" && dedicatedCspCompleted)
    return findings.filter((finding) => finding.code !== "csp-absent");
  if (
    run.checkId === "deep-csp" &&
    data?.applied === false &&
    data.httpObserved !== false &&
    !httpObservationFailed &&
    !findings.some((finding) => finding.code === "csp-absent")
  )
    return [...findings, absentCspFinding];
  return findings;
}

export function deepHttpObservationFailed(
  runs: readonly DeepRunData[],
): boolean {
  const http = runs.find((run) => run.checkId === "deep-http-observation");
  if (!http || http.status !== "completed") return false;
  return http.evidence.some((item) => {
    const data = record(item.data);
    return typeof data?.errorKind === "string";
  });
}

// The cap is the largest deduction one control can contribute. Security
// controls also have a higher per-finding multiplier than informational checks.
const controls = {
  "deep-tls": { cap: 24, multiplier: 2, critical: true },
  "deep-csp": { cap: 22, multiplier: 2, critical: true },
  "deep-security-headers": { cap: 18, multiplier: 2, critical: true },
  "deep-cookies": { cap: 12, multiplier: 1.5, critical: false },
  "deep-forms": { cap: 8, multiplier: 1, critical: false },
  "deep-resources": { cap: 6, multiplier: 1, critical: false },
  "deep-browser-meta": { cap: 6, multiplier: 1, critical: false },
  "deep-endpoints": { cap: 4, multiplier: 1, critical: false },
} as const;

export type DeepScore = {
  value: number | null;
  label: string;
  completedControls: number;
  expectedControls: number;
  limitedCoverage: boolean;
};

export function scoreDeepAudit(runs: readonly DeepRunData[]): DeepScore {
  const dedicatedCspCompleted = runs.some(
    (run) => run.checkId === "deep-csp" && run.status === "completed",
  );
  const httpObservationFailed = deepHttpObservationFailed(runs);
  let penalty = 0;
  let completedControls = 0;
  let missingCritical = false;
  let missingOther = false;

  for (const [checkId, rule] of Object.entries(controls)) {
    const run = runs.find((item) => item.checkId === checkId);
    const data = record(run?.evidence[0]?.data);
    if (
      run?.status !== "completed" ||
      !data ||
      !Array.isArray(data.findings) ||
      (checkId === "deep-csp" &&
        (typeof data.applied !== "boolean" ||
          data.httpObserved === false ||
          httpObservationFailed))
    ) {
      if (rule.critical) missingCritical = true;
      else missingOther = true;
      continue;
    }
    completedControls++;
    const checkPenalty = deepFindings(
      run,
      dedicatedCspCompleted,
      httpObservationFailed,
    ).reduce(
      (sum, finding) =>
        sum +
        (finding.level === "risk" ? 12 : finding.level === "review" ? 6 : 0) *
          rule.multiplier,
      0,
    );
    penalty += Math.min(rule.cap, checkPenalty);
  }

  // No diagnostic observation means that no numerical assessment is possible.
  if (completedControls === 0)
    return {
      value: null,
      label: "Non évalué",
      completedControls,
      expectedControls: Object.keys(controls).length,
      limitedCoverage: true,
    };

  const raw = Math.max(0, Math.min(100, 100 - penalty));
  // Missing controls cannot silently yield an excellent result. This is a
  // coverage ceiling, not a claim that the missing check found a defect.
  const value = Math.min(raw, missingCritical ? 74 : missingOther ? 89 : 100);
  return {
    value,
    label:
      value >= 90
        ? "Très bon"
        : value >= 75
          ? "Bon"
          : value >= 50
            ? "À améliorer"
            : "Corrections prioritaires",
    completedControls,
    expectedControls: Object.keys(controls).length,
    limitedCoverage: missingCritical || missingOther,
  };
}
