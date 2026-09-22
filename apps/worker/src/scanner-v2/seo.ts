import { observeUrl } from "./url.js";

export type SeoSignalLevel = "error" | "warning" | "information" | "opportunity";
export type SeoSignalCode =
  | "seo.http-error"
  | "seo.title.missing"
  | "seo.title.duplicate"
  | "seo.meta-description.missing"
  | "seo.canonical.invalid"
  | "seo.noindex"
  | "seo.lang.missing"
  | "seo.h1.missing"
  | "seo.h1.multiple";

export type SeoSignal = {
  code: SeoSignalCode;
  level: SeoSignalLevel;
  pageUrl: string;
  evidence: Record<string, string | number | boolean | null>;
};

export type SeoDocumentFacts = {
  title: string | null;
  metaDescription: string | null;
  canonicalHref: string | null;
  robots: string[];
  lang: string | null;
  h1Count: number;
  internalLinkCount: number;
  sitemapHrefs: string[];
};

export type SeoPageObservation = {
  url: string;
  statusCode: number | null;
  title: string | null;
  titleLength: number | null;
  metaDescription: string | null;
  metaDescriptionLength: number | null;
  canonicalUrl: string | null;
  canonicalStatus: "missing" | "valid" | "invalid";
  robots: string[];
  indexability: "indexable" | "noindex" | "unknown";
  lang: string | null;
  h1Count: number;
  internalLinkCount: number;
  sitemapUrls: string[];
  signals: SeoSignal[];
};

function trimmedOrNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function normalizeRobots(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) =>
        value
          .split(",")
          .map((directive) => directive.trim().toLowerCase())
          .filter(Boolean),
      ),
    ),
  ].sort();
}

export function analyzeSeoPage(input: {
  url: string;
  statusCode: number | null;
  facts: SeoDocumentFacts;
}): SeoPageObservation | null {
  const pageUrl = observeUrl(input.url);
  if (!pageUrl) {
    return null;
  }

  const title = trimmedOrNull(input.facts.title);
  const metaDescription = trimmedOrNull(input.facts.metaDescription);
  const lang = trimmedOrNull(input.facts.lang);
  const robots = normalizeRobots(input.facts.robots);
  const indexability = robots.includes("noindex")
    ? "noindex"
    : robots.length > 0
      ? "indexable"
      : "unknown";
  const signals: SeoSignal[] = [];
  const add = (
    code: SeoSignalCode,
    level: SeoSignalLevel,
    evidence: Record<string, string | number | boolean | null> = {},
  ) => signals.push({ code, level, pageUrl: pageUrl.displayUrl, evidence });

  if (input.statusCode !== null && input.statusCode >= 400) {
    add("seo.http-error", "error", { statusCode: input.statusCode });
  }
  if (!title) {
    add("seo.title.missing", "warning");
  }
  if (!metaDescription) {
    add("seo.meta-description.missing", "opportunity");
  }
  if (!lang) {
    add("seo.lang.missing", "warning");
  }
  if (input.facts.h1Count === 0) {
    add("seo.h1.missing", "warning");
  } else if (input.facts.h1Count > 1) {
    add("seo.h1.multiple", "information", { h1Count: input.facts.h1Count });
  }
  if (indexability === "noindex") {
    add("seo.noindex", "information");
  }

  let canonicalUrl: string | null = null;
  let canonicalStatus: SeoPageObservation["canonicalStatus"] = "missing";
  const canonicalHref = trimmedOrNull(input.facts.canonicalHref);
  if (canonicalHref) {
    try {
      const resolved = new URL(canonicalHref, input.url);
      const observedCanonical = observeUrl(resolved.toString());
      if (!observedCanonical || (resolved.protocol !== "http:" && resolved.protocol !== "https:")) {
        throw new Error("unsupported canonical URL");
      }
      canonicalUrl = observedCanonical.displayUrl;
      canonicalStatus = "valid";
    } catch {
      canonicalStatus = "invalid";
      add("seo.canonical.invalid", "error");
    }
  }

  const sitemapUrls = input.facts.sitemapHrefs.flatMap((href) => {
    try {
      const resolved = new URL(href, input.url);
      const observed = observeUrl(resolved.toString());
      return observed ? [observed.displayUrl] : [];
    } catch {
      return [];
    }
  });

  return {
    url: pageUrl.displayUrl,
    statusCode: input.statusCode,
    title,
    titleLength: title?.length ?? null,
    metaDescription,
    metaDescriptionLength: metaDescription?.length ?? null,
    canonicalUrl,
    canonicalStatus,
    robots,
    indexability,
    lang,
    h1Count: input.facts.h1Count,
    internalLinkCount: input.facts.internalLinkCount,
    sitemapUrls: [...new Set(sitemapUrls)].sort(),
    signals,
  };
}

export function findDuplicateSeoTitles(
  pages: readonly SeoPageObservation[],
): SeoSignal[] {
  const pagesByTitle = new Map<string, SeoPageObservation[]>();
  for (const page of pages) {
    if (!page.title) {
      continue;
    }
    const key = page.title.trim().toLocaleLowerCase();
    const existing = pagesByTitle.get(key) ?? [];
    existing.push(page);
    pagesByTitle.set(key, existing);
  }

  const signals: SeoSignal[] = [];
  for (const [title, matchingPages] of pagesByTitle) {
    if (matchingPages.length < 2) {
      continue;
    }
    for (const page of matchingPages) {
      signals.push({
        code: "seo.title.duplicate",
        level: "warning",
        pageUrl: page.url,
        evidence: { title, pageCount: matchingPages.length },
      });
    }
  }
  return signals;
}

export type SitemapUrlComparison = {
  sitemapOnlyUrls: string[];
  crawledOnlyUrls: string[];
};

export function compareSitemapUrls(
  sitemapUrls: readonly string[],
  crawledUrls: readonly string[],
): SitemapUrlComparison {
  const normalizedSitemap = new Set(
    sitemapUrls.flatMap((url) => {
      const observed = observeUrl(url);
      return observed ? [observed.displayUrl] : [];
    }),
  );
  const normalizedCrawled = new Set(
    crawledUrls.flatMap((url) => {
      const observed = observeUrl(url);
      return observed ? [observed.displayUrl] : [];
    }),
  );
  return {
    sitemapOnlyUrls: [...normalizedSitemap]
      .filter((url) => !normalizedCrawled.has(url))
      .sort(),
    crawledOnlyUrls: [...normalizedCrawled]
      .filter((url) => !normalizedSitemap.has(url))
      .sort(),
  };
}

export type RobotsRule = {
  userAgent: string;
  allow: string[];
  disallow: string[];
};

export type RobotsTxtObservation = {
  sitemaps: string[];
  rules: RobotsRule[];
};

/**
 * Deliberately small parser for deterministic monitoring facts. It does not
 * attempt to be a complete robots policy engine; consumers retain the raw
 * allow/disallow paths and can apply their own crawler policy later.
 */
export function parseRobotsTxt(contents: string): RobotsTxtObservation {
  const sitemaps: string[] = [];
  const groups = new Map<string, { allow: string[]; disallow: string[] }>();
  let currentAgents: string[] = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 1) {
      continue;
    }
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!value) {
      continue;
    }
    if (field === "sitemap") {
      sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      currentAgents = [value.toLowerCase()];
      if (!groups.has(currentAgents[0]!)) {
        groups.set(currentAgents[0]!, { allow: [], disallow: [] });
      }
      continue;
    }
    if ((field !== "allow" && field !== "disallow") || currentAgents.length === 0) {
      continue;
    }
    for (const agent of currentAgents) {
      const rules = groups.get(agent);
      if (rules) {
        rules[field].push(value);
      }
    }
  }

  return {
    sitemaps: [...new Set(sitemaps)].sort(),
    rules: [...groups.entries()]
      .map(([userAgent, rules]) => ({
        userAgent,
        allow: [...new Set(rules.allow)].sort(),
        disallow: [...new Set(rules.disallow)].sort(),
      }))
      .sort((left, right) => left.userAgent.localeCompare(right.userAgent)),
  };
}

export function parseSitemapXml(contents: string): string[] {
  const locations: string[] = [];
  const locationPattern = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  for (const match of contents.matchAll(locationPattern)) {
    const value = match[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    if (value) {
      locations.push(value);
    }
  }
  return [...new Set(locations)].sort();
}
