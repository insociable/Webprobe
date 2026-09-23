export type ReportSeverity = "info" | "low" | "medium" | "high" | "critical";

export type ReportFindingLike = {
  category: string;
  severity: ReportSeverity;
  code: string;
  title: string;
  pageUrl?: string | null;
};

export type FindingBusinessContext = {
  impact: string;
  intervention: string;
  effort: "Faible" | "Modéré" | "Élevé";
};

export const reportSeverityRank: Record<ReportSeverity, number> = {
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

const categoryImpact: Record<string, string> = {
  availability:
    "Le site peut devenir indisponible, répondre en erreur ou dégrader directement le parcours d’un visiteur.",
  "broken-link":
    "Un visiteur peut rencontrer un parcours cassé ou quitter le site avant d’atteindre l’information recherchée.",
  javascript:
    "Une fonctionnalité visible peut ne pas fonctionner correctement dans le navigateur.",
  tls: "La connexion HTTPS peut perdre en fiabilité ou afficher un avertissement si le problème n’est pas traité.",
  "security-header":
    "La protection côté navigateur est moins restrictive qu’elle pourrait l’être face à certains scénarios d’abus.",
  accessibility:
    "Certains visiteurs, notamment avec des technologies d’assistance, peuvent rencontrer une utilisation plus difficile.",
  performance:
    "Un chargement lent ou instable peut augmenter l’attente perçue et l’abandon avant interaction.",
  seo: "Le contenu peut être moins bien compris, indexé ou présenté par les moteurs de recherche.",
  network:
    "Une ressource nécessaire à l’affichage ou au fonctionnement du site peut ne pas se charger correctement.",
};

function effortForFinding(
  finding: ReportFindingLike,
): FindingBusinessContext["effort"] {
  if (
    finding.code === "security-header.csp.missing" ||
    finding.code === "tls.connection-failed" ||
    finding.code.startsWith("performance.") ||
    finding.code.startsWith("javascript.")
  ) {
    return "Modéré";
  }

  if (
    finding.code.startsWith("availability.") &&
    finding.severity === "critical"
  ) {
    return "Élevé";
  }

  if (
    finding.code.startsWith("security-header.") ||
    finding.code.startsWith("seo.") ||
    finding.code.startsWith("broken-link.")
  ) {
    return "Faible";
  }

  if (finding.code.startsWith("accessibility.")) {
    return "Modéré";
  }

  return finding.severity === "critical" ? "Élevé" : "Modéré";
}

function interventionForCategory(category: string): string {
  switch (category) {
    case "security-header":
      return "Configuration serveur / CDN";
    case "tls":
      return "TLS / hébergement";
    case "availability":
      return "Hébergement / application";
    case "broken-link":
      return "Contenu / routage";
    case "javascript":
      return "Développement front-end";
    case "accessibility":
      return "Front-end / accessibilité";
    case "performance":
      return "Performance web";
    case "seo":
      return "SEO technique / contenu";
    case "network":
      return "Front-end / ressources réseau";
    default:
      return "Diagnostic technique";
  }
}

export function getFindingBusinessContext(
  finding: ReportFindingLike,
): FindingBusinessContext {
  return {
    impact:
      categoryImpact[finding.category] ??
      "Ce point peut affecter la qualité, la fiabilité ou la maintenabilité du site et mérite une vérification technique.",
    intervention: interventionForCategory(finding.category),
    effort: effortForFinding(finding),
  };
}

export function sortFindingsByPriority<T extends ReportFindingLike>(
  findings: readonly T[],
): T[] {
  return [...findings].sort((a, b) => {
    const severityDelta =
      reportSeverityRank[b.severity] - reportSeverityRank[a.severity];
    if (severityDelta !== 0) return severityDelta;
    return a.code.localeCompare(b.code);
  });
}

export function getPriorityFindings<T extends ReportFindingLike>(
  findings: readonly T[],
  limit = 3,
): T[] {
  if (limit <= 0) return [];
  return sortFindingsByPriority(findings).slice(0, limit);
}

export function summarizeReportFindings(
  findings: readonly ReportFindingLike[],
) {
  const bySeverity: Record<ReportSeverity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  const byCategory: Record<string, number> = {};

  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
  }

  return {
    total: findings.length,
    highOrCritical: bySeverity.high + bySeverity.critical,
    bySeverity,
    byCategory,
  };
}
