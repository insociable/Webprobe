import type { Severity } from "@agency-saas/contracts";
import { createFindingFingerprint, type GeneratedFinding } from "./findings.js";

export type AccessibilityImpact =
  | "minor"
  | "moderate"
  | "serious"
  | "critical"
  | null;

export type AccessibilityViolationObservation = {
  ruleId: string;
  impact: AccessibilityImpact;
  nodeCount: number;
};

export type BrowserPageObservation = {
  url: string;
  sourcePageUrl: string | null;
  statusCode: number | null;
  navigationFailed: boolean;
  javascriptErrorCount: number;
  accessibilityViolations: AccessibilityViolationObservation[];
};
function makeFinding(
  input: Omit<GeneratedFinding, "fingerprint">,
): GeneratedFinding {
  return {
    ...input,
    fingerprint: createFindingFingerprint(
      input.category,
      input.code,
      input.pageUrl,
    ),
  };
}

export function accessibilitySeverity(impact: AccessibilityImpact): Severity {
  switch (impact) {
    case "critical":
      return "high";
    case "serious":
      return "medium";
    case "moderate":
      return "low";
    case "minor":
    case null:
      return "info";
  }
}

function brokenLinkFinding(
  observation: BrowserPageObservation,
): GeneratedFinding | null {
  if (!observation.sourcePageUrl) {
    return null;
  }

  if (
    !observation.navigationFailed &&
    (observation.statusCode === null || observation.statusCode < 400)
  ) {
    return null;
  }

  const serverError =
    observation.statusCode !== null && observation.statusCode >= 500;

  return makeFinding({
    category: "broken-link",
    severity: serverError ? "high" : "medium",
    code: observation.navigationFailed
      ? "broken-link.navigation-failed"
      : "broken-link.http-error",
    title: observation.navigationFailed
      ? "Un lien interne est inaccessible"
      : "Un lien interne retourne une erreur HTTP",
    pageUrl: observation.url,
    evidence: {
      sourcePageUrl: observation.sourcePageUrl,
      ...(observation.statusCode === null
        ? {}
        : { statusCode: observation.statusCode }),
    },
  });
}

function javascriptFinding(
  observation: BrowserPageObservation,
): GeneratedFinding | null {
  if (observation.javascriptErrorCount < 1) {
    return null;
  }

  return makeFinding({
    category: "javascript",
    severity: "medium",
    code: "javascript.uncaught-error",
    title: "Erreur JavaScript non interceptée",
    pageUrl: observation.url,
    evidence: {
      errorCount: observation.javascriptErrorCount,
    },
  });
}

function accessibilityFindings(
  observation: BrowserPageObservation,
): GeneratedFinding[] {
  return observation.accessibilityViolations.map((violation) =>
    makeFinding({
      category: "accessibility",
      severity: accessibilitySeverity(violation.impact),
      code: `accessibility.${violation.ruleId}`,
      title: `Accessibilité : règle ${violation.ruleId} non respectée`,
      pageUrl: observation.url,
      evidence: {
        ruleId: violation.ruleId,
        impact: violation.impact ?? "unknown",
        nodeCount: violation.nodeCount,
      },
    }),
  );
}

export function generateBrowserFindings(
  observations: BrowserPageObservation[],
): GeneratedFinding[] {
  const findings: GeneratedFinding[] = [];

  for (const observation of observations) {
    const brokenLink = brokenLinkFinding(observation);
    if (brokenLink) {
      findings.push(brokenLink);
    }

    const javascript = javascriptFinding(observation);
    if (javascript) {
      findings.push(javascript);
    }

    findings.push(...accessibilityFindings(observation));
  }

  return findings;
}
