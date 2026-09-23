import type { Severity } from "@agency-saas/contracts";
import {
  createFindingFingerprint,
  type GeneratedFinding,
} from "../findings.js";
import type { ScannerV2Completeness } from "../browser-scan.js";
import type { CrawlCoverage } from "./crawl.js";
import type { NetworkIssueEvidence, NetworkObservation } from "./network.js";
import type { LabPerformanceObservation } from "./performance.js";
import type { SeoSignal, SeoSignalLevel } from "./seo.js";

export type ScannerV2Data = {
  crawl: CrawlCoverage;
  network: NetworkObservation;
  performance: LabPerformanceObservation[];
  seo: { signals: SeoSignal[] };
  completeness: ScannerV2Completeness;
};

export type ScannerV2PersistentSummary = {
  version: 1;
  completeness: ScannerV2Completeness;
  crawl: {
    discoveredUrlCount: number;
    visitedUrlCount: number;
    unvisitedUrlCount: number;
    ignoredUrlCount: number;
    redirectCount: number;
    malformedUrlCount: number;
    budgetReached: boolean;
    robotsRestricted: boolean;
    robotsPolicyUnavailable: boolean;
  };
  network: {
    issueCount: number;
    suppressedThirdPartyIssueCount: number;
    collectionTruncated: boolean;
  };
  performance: {
    observedPageCount: number;
  };
  seo: {
    observedPageCount: number;
    signalCount: number;
  };
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

function seoSeverity(level: SeoSignalLevel): Severity {
  switch (level) {
    case "error":
      return "medium";
    case "warning":
    case "opportunity":
      return "low";
    case "information":
      return "info";
  }
}

const seoTitles: Record<SeoSignal["code"], string> = {
  "seo.http-error": "Une page SEO retourne une erreur HTTP",
  "seo.title.missing": "Balise title absente",
  "seo.title.duplicate": "Balise title dupliquée",
  "seo.meta-description.missing": "Meta description absente",
  "seo.canonical.invalid": "URL canonique invalide",
  "seo.noindex": "Page exclue de l’indexation",
  "seo.lang.missing": "Langue du document non déclarée",
  "seo.h1.missing": "Titre H1 absent",
  "seo.h1.multiple": "Plusieurs titres H1 détectés",
};

function seoFindings(signals: readonly SeoSignal[]): GeneratedFinding[] {
  return signals.map((signal) =>
    makeFinding({
      category: "seo",
      severity: seoSeverity(signal.level),
      code: signal.code,
      title: seoTitles[signal.code],
      pageUrl: signal.pageUrl,
      evidence: signal.evidence,
    }),
  );
}

function networkSeverity(issue: NetworkIssueEvidence): Severity {
  switch (issue.kind) {
    case "http-5xx":
      return "high";
    case "http-4xx":
    case "request-failed":
      return "medium";
    case "console-error":
    case "javascript-error":
      return "low";
  }
}

function networkTitle(issue: NetworkIssueEvidence): string {
  switch (issue.kind) {
    case "http-5xx":
      return "Une ressource du site retourne une erreur serveur";
    case "http-4xx":
      return "Une ressource du site retourne une erreur HTTP";
    case "request-failed":
      return "Une ressource du site n’a pas pu être chargée";
    case "console-error":
      return "Erreur signalée dans la console navigateur";
    case "javascript-error":
      return "Erreur JavaScript observée pendant le chargement";
  }
}

function networkFindings(network: NetworkObservation): GeneratedFinding[] {
  return network.issues.flatMap((issue) => {
    // The legacy browser analyzer already creates a generic JavaScript finding.
    // Avoid double-reporting the same browser-side symptom here.
    if (issue.kind === "console-error" || issue.kind === "javascript-error") {
      return [];
    }

    const pageUrl = issue.resourceUrl ?? issue.affectedPageUrls[0];
    if (!pageUrl) {
      return [];
    }

    return [
      makeFinding({
        category: "network",
        severity: networkSeverity(issue),
        code: `network.${issue.kind}`,
        title: networkTitle(issue),
        pageUrl,
        evidence: {
          party: issue.party,
          resourceType: issue.resourceType,
          statusCode: issue.statusCode,
          failureClass: issue.failureClass,
          occurrenceCount: issue.occurrenceCount,
          affectedPageCount: issue.affectedPageUrls.length,
        },
      }),
    ];
  });
}

type PerformanceRule = {
  code: string;
  title: string;
  value: number | null;
  warning: number;
  high?: number;
  unit: "ms" | "ratio" | "count" | "bytes";
};

function performanceRuleFinding(
  page: LabPerformanceObservation,
  rule: PerformanceRule,
): GeneratedFinding | null {
  if (rule.value === null || rule.value <= rule.warning) {
    return null;
  }
  return makeFinding({
    category: "performance",
    severity:
      rule.high !== undefined && rule.value > rule.high ? "high" : "medium",
    code: rule.code,
    title: rule.title,
    pageUrl: page.url,
    evidence: {
      observedValue: rule.value,
      warningThreshold: rule.warning,
      ...(rule.high === undefined ? {} : { highThreshold: rule.high }),
      unit: rule.unit,
    },
  });
}

function performanceFindings(
  observations: readonly LabPerformanceObservation[],
): GeneratedFinding[] {
  return observations.flatMap((page) => {
    const rules: PerformanceRule[] = [
      {
        code: "performance.ttfb.slow",
        title: "Temps de réponse serveur élevé",
        value: page.ttfbMs,
        warning: 800,
        high: 1_800,
        unit: "ms",
      },
      {
        code: "performance.fcp.slow",
        title: "Premier affichage de contenu lent",
        value: page.firstContentfulPaintMs,
        warning: 1_800,
        high: 3_000,
        unit: "ms",
      },
      {
        code: "performance.lcp.slow",
        title: "Affichage du contenu principal lent",
        value: page.largestContentfulPaintMs,
        warning: 2_500,
        high: 4_000,
        unit: "ms",
      },
      {
        code: "performance.cls.high",
        title: "Stabilité visuelle insuffisante",
        value: page.cumulativeLayoutShift,
        warning: 0.1,
        high: 0.25,
        unit: "ratio",
      },
      {
        code: "performance.tbt.high",
        title: "Temps de blocage JavaScript élevé",
        value: page.totalBlockingTimeMs,
        warning: 200,
        high: 600,
        unit: "ms",
      },
      {
        code: "performance.navigation.slow",
        title: "Chargement global de la page lent",
        value: page.navigationDurationMs,
        warning: 3_000,
        high: 5_000,
        unit: "ms",
      },
      {
        code: "performance.requests.high",
        title: "Nombre de requêtes réseau élevé",
        value: page.totalRequestCount,
        warning: 100,
        high: 180,
        unit: "count",
      },
      {
        code: "performance.transfer.large",
        title: "Volume transféré élevé",
        value: page.transferBytes,
        warning: 3 * 1024 * 1024,
        high: 6 * 1024 * 1024,
        unit: "bytes",
      },
    ];
    return rules.flatMap((rule) => {
      const finding = performanceRuleFinding(page, rule);
      return finding ? [finding] : [];
    });
  });
}

export function generateScannerV2Findings(
  scannerV2: ScannerV2Data,
): GeneratedFinding[] {
  return [
    ...seoFindings(scannerV2.seo.signals),
    ...networkFindings(scannerV2.network),
    ...performanceFindings(scannerV2.performance),
  ];
}

export function summarizeScannerV2(
  scannerV2: ScannerV2Data,
): ScannerV2PersistentSummary {
  return {
    version: 1,
    completeness: scannerV2.completeness,
    crawl: {
      discoveredUrlCount: scannerV2.crawl.discoveredUrlCount,
      visitedUrlCount: scannerV2.crawl.visitedUrlCount,
      unvisitedUrlCount: scannerV2.crawl.unvisitedUrlCount,
      ignoredUrlCount: scannerV2.crawl.ignoredUrlCount,
      redirectCount: scannerV2.crawl.redirects.length,
      malformedUrlCount: scannerV2.crawl.malformedUrlCount,
      budgetReached: scannerV2.crawl.budgetReached,
      robotsRestricted: scannerV2.crawl.robotsRestricted,
      robotsPolicyUnavailable: scannerV2.crawl.robotsPolicyUnavailable,
    },
    network: {
      issueCount: scannerV2.network.issues.length,
      suppressedThirdPartyIssueCount:
        scannerV2.network.suppressedThirdPartyIssueCount,
      collectionTruncated: scannerV2.network.collection.truncated,
    },
    performance: {
      observedPageCount: scannerV2.performance.length,
    },
    seo: {
      observedPageCount: scannerV2.completeness.seo.observedPageCount,
      signalCount: scannerV2.seo.signals.length,
    },
  };
}
