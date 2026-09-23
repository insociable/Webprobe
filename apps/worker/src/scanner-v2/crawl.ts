import { observeUrl, type ObservedUrl } from "./url.js";

export type CrawlExclusionReason =
  | "malformed-url"
  | "non-http"
  | "credentials"
  | "external-origin"
  | "duplicate"
  | "page-budget"
  | "robots-disallowed";

export type CrawlCandidate = ObservedUrl & {
  navigationUrl: string;
};

export type CrawlCandidateResult =
  | { accepted: true; candidate: CrawlCandidate }
  | {
      accepted: false;
      reason: CrawlExclusionReason;
      observedUrl: ObservedUrl | null;
    };

export type CrawlEntryState =
  | "queued"
  | "visited"
  | "navigation-failed"
  | "not-visited"
  | "ignored";

export type CrawlUrlObservation = {
  url: string;
  urlKey: string;
  origin: string;
  sourcePageUrls: string[];
  duplicateDiscoveryCount: number;
  state: CrawlEntryState;
  exclusionReason: CrawlExclusionReason | null;
  finalUrl: string | null;
  statusCode: number | null;
};

export type CrawlRedirectObservation = {
  fromUrl: string;
  toUrl: string;
  statusCode: number | null;
};

export type CrawlCoverage = {
  maxPages: number;
  discoveredUrlCount: number;
  visitedUrlCount: number;
  ignoredUrlCount: number;
  unvisitedUrlCount: number;
  budgetReached: boolean;
  urls: CrawlUrlObservation[];
  redirects: CrawlRedirectObservation[];
  malformedUrlCount: number;
  robotsRestricted: boolean;
  robotsPolicyUnavailable: boolean;
};

type MutableCrawlEntry = CrawlUrlObservation & { sourceUrls: Set<string> };

export function classifyCrawlCandidate(
  rawHref: string,
  currentPageUrl: string,
  crawlOrigin: string,
): CrawlCandidateResult {
  let url: URL;
  try {
    url = new URL(rawHref, currentPageUrl);
  } catch {
    return { accepted: false, reason: "malformed-url", observedUrl: null };
  }

  const observedUrl = observeUrl(url.toString());
  if (!observedUrl) {
    return { accepted: false, reason: "malformed-url", observedUrl: null };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { accepted: false, reason: "non-http", observedUrl };
  }
  if (url.username || url.password) {
    return { accepted: false, reason: "credentials", observedUrl };
  }
  if (url.origin !== crawlOrigin) {
    return { accepted: false, reason: "external-origin", observedUrl };
  }

  url.hash = "";
  const candidate = observeUrl(url.toString());
  if (!candidate) {
    return { accepted: false, reason: "malformed-url", observedUrl: null };
  }

  return {
    accepted: true,
    candidate: { ...candidate, navigationUrl: url.toString() },
  };
}

export class CrawlCoverageTracker {
  private readonly entries = new Map<string, MutableCrawlEntry>();
  /** Redirect destinations are aliases of the document that rendered them. */
  private readonly redirectAliases = new Map<string, string>();
  private readonly redirects: CrawlRedirectObservation[] = [];
  private malformedUrlCount = 0;
  private reachedBudget = false;
  private robotsRestricted = false;
  private robotsPolicyUnavailable = false;

  constructor(private readonly maxPages: number) {}

  discover(candidate: CrawlCandidate, sourcePageUrl: string | null): boolean {
    const existing = this.entries.get(
      this.redirectAliases.get(candidate.urlKey) ?? candidate.urlKey,
    );
    if (existing) {
      if (sourcePageUrl) {
        existing.sourceUrls.add(sourcePageUrl);
      }
      existing.duplicateDiscoveryCount += 1;
      return false;
    }

    this.entries.set(candidate.urlKey, {
      url: candidate.displayUrl,
      urlKey: candidate.urlKey,
      origin: candidate.origin,
      sourcePageUrls: [],
      sourceUrls: new Set(sourcePageUrl ? [sourcePageUrl] : []),
      duplicateDiscoveryCount: 0,
      state: "queued",
      exclusionReason: null,
      finalUrl: null,
      statusCode: null,
    });
    return true;
  }

  ignore(
    result: Exclude<CrawlCandidateResult, { accepted: true }>,
    sourcePageUrl: string | null,
  ): void {
    if (!result.observedUrl) {
      this.malformedUrlCount += 1;
      return;
    }

    const existing = this.entries.get(result.observedUrl.urlKey);
    if (existing) {
      if (sourcePageUrl) {
        existing.sourceUrls.add(sourcePageUrl);
      }
      existing.duplicateDiscoveryCount += 1;
      return;
    }
    this.entries.set(result.observedUrl.urlKey, {
      url: result.observedUrl.displayUrl,
      urlKey: result.observedUrl.urlKey,
      origin: result.observedUrl.origin,
      sourcePageUrls: [],
      sourceUrls: new Set(sourcePageUrl ? [sourcePageUrl] : []),
      duplicateDiscoveryCount: 0,
      state: "ignored",
      exclusionReason: result.reason,
      finalUrl: null,
      statusCode: null,
    });
  }

  markRobotsDisallowed(
    candidate: CrawlCandidate,
    sourcePageUrl: string | null,
  ): void {
    const isNew = this.discover(candidate, sourcePageUrl);
    const entry = this.entries.get(
      this.redirectAliases.get(candidate.urlKey) ?? candidate.urlKey,
    );
    if (isNew && entry) {
      entry.state = "not-visited";
      entry.exclusionReason = "robots-disallowed";
    }
    this.robotsRestricted = true;
  }

  markRobotsRestricted(): void {
    this.robotsRestricted = true;
  }

  markRobotsPolicyUnavailable(): void {
    this.robotsPolicyUnavailable = true;
  }

  markRemainingBudgetExceeded(): void {
    for (const entry of this.entries.values()) {
      if (entry.state === "queued") {
        entry.state = "not-visited";
        entry.exclusionReason = "page-budget";
        this.reachedBudget = true;
      }
    }
  }

  markBudgetExceeded(candidate: CrawlCandidate, sourcePageUrl: string): void {
    const isNew = this.discover(candidate, sourcePageUrl);
    const entry = this.entries.get(
      this.redirectAliases.get(candidate.urlKey) ?? candidate.urlKey,
    );
    if (isNew && entry) {
      entry.state = "not-visited";
      entry.exclusionReason = "page-budget";
    }
    this.reachedBudget = true;
  }

  markVisited(
    candidate: CrawlCandidate,
    input: {
      finalUrl: string;
      statusCode: number | null;
      navigationFailed: boolean;
    },
  ): void {
    if (!this.entries.has(candidate.urlKey)) {
      this.discover(candidate, null);
    }
    const entry = this.entries.get(candidate.urlKey);
    if (!entry) {
      return;
    }

    entry.state = input.navigationFailed ? "navigation-failed" : "visited";
    entry.statusCode = input.statusCode;
    const finalUrl = observeUrl(input.finalUrl);
    entry.finalUrl = finalUrl?.displayUrl ?? null;
    if (finalUrl && finalUrl.urlKey !== candidate.urlKey) {
      const destinationEntry = this.entries.get(finalUrl.urlKey);
      if (destinationEntry && destinationEntry !== entry) {
        if (destinationEntry.state === "queued") {
          for (const sourceUrl of destinationEntry.sourceUrls) {
            entry.sourceUrls.add(sourceUrl);
          }
          entry.duplicateDiscoveryCount +=
            destinationEntry.duplicateDiscoveryCount + 1;
          this.entries.delete(finalUrl.urlKey);
        } else {
          // The redirect target was already visited independently, so keep its
          // coverage entry rather than concealing a completed navigation.
          this.redirects.push({
            fromUrl: candidate.displayUrl,
            toUrl: finalUrl.displayUrl,
            statusCode: input.statusCode,
          });
          return;
        }
      }
      this.redirectAliases.set(finalUrl.urlKey, entry.urlKey);
      this.redirects.push({
        fromUrl: candidate.displayUrl,
        toUrl: finalUrl.displayUrl,
        statusCode: input.statusCode,
      });
    }
  }

  coverage(): CrawlCoverage {
    const urls = [...this.entries.values()].map((entry) => ({
      url: entry.url,
      urlKey: entry.urlKey,
      origin: entry.origin,
      sourcePageUrls: [...entry.sourceUrls].sort(),
      duplicateDiscoveryCount: entry.duplicateDiscoveryCount,
      state: entry.state,
      exclusionReason: entry.exclusionReason,
      finalUrl: entry.finalUrl,
      statusCode: entry.statusCode,
    }));
    const visitedUrlCount = urls.filter(
      (entry) =>
        entry.state === "visited" || entry.state === "navigation-failed",
    ).length;
    const ignoredUrlCount = urls.filter(
      (entry) => entry.state === "ignored",
    ).length;
    const unvisitedUrlCount = urls.filter(
      (entry) => entry.state === "not-visited" || entry.state === "queued",
    ).length;

    return {
      maxPages: this.maxPages,
      discoveredUrlCount: urls.length,
      visitedUrlCount,
      ignoredUrlCount,
      unvisitedUrlCount,
      budgetReached: this.reachedBudget,
      urls,
      redirects: [...this.redirects],
      malformedUrlCount: this.malformedUrlCount,
      robotsRestricted: this.robotsRestricted,
      robotsPolicyUnavailable: this.robotsPolicyUnavailable,
    };
  }
}
