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

const findingDisplayTitles: Record<string, string> = {
  "accessibility.region":
    "Certains contenus ne sont pas rattachés à une zone de navigation identifiable",
  "accessibility.landmark-one-main":
    "La page ne contient pas exactement une zone principale <main>",
  "accessibility.color-contrast": "Contraste de texte insuffisant",
  "accessibility.heading-order": "Hiérarchie des titres incohérente",
  "accessibility.image-alt":
    "Une image informative n’a pas d’alternative textuelle adaptée",
  "accessibility.button-name": "Un bouton n’a pas de nom accessible explicite",
  "accessibility.link-name": "Un lien n’a pas de nom accessible explicite",
  "accessibility.html-has-lang":
    "La langue principale du document n’est pas déclarée",
  "accessibility.document-title":
    "Le document ne possède pas de titre exploitable",
  "accessibility.label": "Un champ de formulaire n’a pas de libellé accessible",
  "accessibility.page-has-heading-one":
    "La page ne possède pas de titre principal H1",
  "accessibility.landmark-unique":
    "Deux zones de navigation ont le même rôle sans distinction",
};

const exactFindingImpact: Record<string, string> = {
  "accessibility.region":
    "Du contenu placé hors des zones structurelles (main, nav, header, footer, aside…) est plus difficile à repérer et à contourner avec un lecteur d’écran.",
  "accessibility.landmark-one-main":
    "Sans une zone principale unique, une personne utilisant un lecteur d’écran perd un raccourci essentiel pour atteindre directement le contenu central de la page.",
  "accessibility.color-contrast":
    "Un contraste insuffisant peut rendre le texte difficile à lire pour les personnes malvoyantes, daltoniennes ou dans de mauvaises conditions d’affichage.",
  "accessibility.heading-order":
    "Une hiérarchie de titres incohérente rend la structure du contenu moins compréhensible et complique la navigation rapide par titres avec les technologies d’assistance.",
  "accessibility.image-alt":
    "Une image porteuse d’information peut devenir incompréhensible pour une personne qui ne la voit pas si aucune alternative textuelle équivalente n’est fournie.",
  "accessibility.button-name":
    "Un bouton sans nom accessible peut être annoncé de façon vague ou inutilisable par un lecteur d’écran ou une commande vocale.",
  "accessibility.link-name":
    "Un lien sans libellé accessible ne permet pas de comprendre clairement sa destination ou son action hors de son contexte visuel.",
  "accessibility.html-has-lang":
    "Sans langue déclarée, un lecteur d’écran peut choisir une mauvaise prononciation et rendre la lecture nettement moins intelligible.",
  "accessibility.document-title":
    "Un titre de document absent ou vide complique l’identification de la page dans les onglets, l’historique et les technologies d’assistance.",
  "accessibility.label":
    "Un champ sans libellé accessible peut être difficile, voire impossible, à identifier correctement avec un lecteur d’écran.",
  "accessibility.page-has-heading-one":
    "L’absence de titre principal H1 rend la structure générale de la page moins explicite pour les visiteurs et les technologies d’assistance.",
  "accessibility.landmark-unique":
    "Des zones structurelles identiques et non distinguées rendent la navigation par landmarks ambiguë pour les utilisateurs de lecteurs d’écran.",
  "security-header.csp.missing":
    "Sans Content-Security-Policy, le navigateur dispose de moins de garde-fous pour limiter les sources de scripts, styles et contenus pouvant s’exécuter ou se charger.",
  "security-header.hsts.missing":
    "Sans HSTS, un navigateur n’est pas explicitement forcé à réutiliser HTTPS lors des visites suivantes, ce qui réduit la protection contre certains scénarios de downgrade.",
  "security-header.x-frame-options.missing":
    "Sans protection contre l’encapsulation en iframe, la page est davantage exposée aux scénarios de clickjacking si aucune directive CSP équivalente n’est définie.",
  "security-header.permissions-policy.missing":
    "Sans Permissions-Policy, les fonctionnalités sensibles du navigateur ne sont pas explicitement restreintes aux seuls usages nécessaires au site.",
  "seo.noindex":
    "Une page marquée noindex demande explicitement aux moteurs de recherche de ne pas l’indexer ; cela peut être voulu ou bloquer involontairement sa visibilité.",
  "seo.title.duplicate":
    "Des pages différentes partageant le même titre sont plus difficiles à distinguer pour les moteurs de recherche et pour les utilisateurs dans les résultats ou les onglets.",
};

export function getFindingDisplayTitle(finding: ReportFindingLike): string {
  return findingDisplayTitles[finding.code] ?? finding.title;
}

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
      exactFindingImpact[finding.code] ??
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

export type ReportSectionKey =
  | "security"
  | "seo"
  | "performance"
  | "network"
  | "accessibility"
  | "other";

export type ReportSectionDefinition = {
  key: ReportSectionKey;
  label: string;
  description: string;
};

export const reportSectionDefinitions: ReportSectionDefinition[] = [
  {
    key: "security",
    label: "Sécurité",
    description:
      "HTTPS, en-têtes navigateur et signaux de protection observables publiquement.",
  },
  {
    key: "seo",
    label: "SEO",
    description:
      "Signaux techniques qui influencent l’indexation et la compréhension du contenu.",
  },
  {
    key: "performance",
    label: "Performance",
    description:
      "Temps de chargement, stabilité visuelle et erreurs JavaScript observées.",
  },
  {
    key: "network",
    label: "Réseau / disponibilité",
    description:
      "Accessibilité HTTP, ressources réseau et liens internes observés pendant le scan.",
  },
  {
    key: "accessibility",
    label: "Accessibilité",
    description:
      "Contrôles automatisés pouvant affecter l’usage au clavier ou avec assistance.",
  },
  {
    key: "other",
    label: "Autres signaux",
    description: "Constats qui ne rentrent pas dans les domaines principaux.",
  },
];

export function reportSectionKeyForFinding(
  finding: ReportFindingLike,
): ReportSectionKey {
  switch (finding.category) {
    case "security-header":
    case "tls":
      return "security";
    case "seo":
      return "seo";
    case "performance":
    case "javascript":
      return "performance";
    case "network":
    case "availability":
    case "broken-link":
      return "network";
    case "accessibility":
      return "accessibility";
    default:
      return "other";
  }
}

export function summarizeReportSections(
  findings: readonly ReportFindingLike[],
) {
  const summaries = new Map<
    ReportSectionKey,
    {
      definition: ReportSectionDefinition;
      total: number;
      highOrCritical: number;
      highestSeverity: ReportSeverity | null;
    }
  >();

  for (const definition of reportSectionDefinitions) {
    summaries.set(definition.key, {
      definition,
      total: 0,
      highOrCritical: 0,
      highestSeverity: null,
    });
  }

  for (const finding of findings) {
    const key = reportSectionKeyForFinding(finding);
    const summary = summaries.get(key);
    if (!summary) continue;
    summary.total += 1;
    if (finding.severity === "high" || finding.severity === "critical") {
      summary.highOrCritical += 1;
    }
    if (
      summary.highestSeverity === null ||
      reportSeverityRank[finding.severity] >
        reportSeverityRank[summary.highestSeverity]
    ) {
      summary.highestSeverity = finding.severity;
    }
  }

  return reportSectionDefinitions
    .map((definition) => summaries.get(definition.key)!)
    .filter((summary) => summary.total > 0);
}

export function groupFindingsByReportSection<T extends ReportFindingLike>(
  findings: readonly T[],
) {
  const grouped = new Map<ReportSectionKey, T[]>();
  for (const finding of findings) {
    const key = reportSectionKeyForFinding(finding);
    const bucket = grouped.get(key) ?? [];
    bucket.push(finding);
    grouped.set(key, bucket);
  }

  return reportSectionDefinitions.flatMap((definition) => {
    const items = grouped.get(definition.key) ?? [];
    return items.length > 0 ? [{ definition, findings: items }] : [];
  });
}
