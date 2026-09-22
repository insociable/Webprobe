import type { NetworkResourceObservation } from "./network.js";
import { observeUrl } from "./url.js";

export type LabResourceCategory = "javascript" | "css" | "images" | "fonts" | "other";
export type LabPerformanceContext = {
  viewport: { width: number; height: number };
  userAgent: string;
  measuredAt: string;
  scanProfile: { navigationTimeoutMs: number; maxPages: number };
  cacheState: "unknown" | "cold" | "warm";
  engineVersion: string;
};

export type BrowserLabTiming = {
  requestStart: number | null;
  responseStart: number | null;
  domContentLoadedEventEnd: number | null;
  firstContentfulPaint: number | null;
  largestContentfulPaint: number | null;
  cumulativeLayoutShift: number | null;
  totalBlockingTime: number | null;
};

export type LabPerformanceObservation = {
  url: string;
  context: LabPerformanceContext;
  ttfbMs: number | null;
  firstContentfulPaintMs: number | null;
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number | null;
  totalBlockingTimeMs: number | null;
  navigationDurationMs: number | null;
  totalRequestCount: number;
  transferBytes: number | null;
  transferBytesByCategory: Record<LabResourceCategory, number>;
  cache: { responseCount: number; cacheControlledResponseCount: number };
  compression: { encodedResponseCount: number; encodings: string[] };
};

function roundedNonNegative(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : null;
}

function difference(end: number | null, start: number | null): number | null {
  if (end === null || start === null) {
    return null;
  }
  return roundedNonNegative(end - start);
}

function categoryFor(resourceType: NetworkResourceObservation["resourceType"]): LabResourceCategory {
  switch (resourceType) {
    case "script":
      return "javascript";
    case "stylesheet":
      return "css";
    case "image":
      return "images";
    case "font":
      return "fonts";
    default:
      return "other";
  }
}

export function createLabPerformanceObservation(input: {
  url: string;
  context: LabPerformanceContext;
  timing: BrowserLabTiming;
  resources: NetworkResourceObservation[];
}): LabPerformanceObservation | null {
  const observedUrl = observeUrl(input.url);
  if (!observedUrl) {
    return null;
  }

  const transferBytesByCategory: Record<LabResourceCategory, number> = {
    javascript: 0,
    css: 0,
    images: 0,
    fonts: 0,
    other: 0,
  };
  let hasKnownTransferBytes = false;
  let transferBytes = 0;
  let cacheControlledResponseCount = 0;
  const encodings = new Set<string>();

  for (const resource of input.resources) {
    const category = categoryFor(resource.resourceType);
    if (resource.transferBytes !== null) {
      hasKnownTransferBytes = true;
      transferBytes += resource.transferBytes;
      transferBytesByCategory[category] += resource.transferBytes;
    }
    if (resource.cacheControl) {
      cacheControlledResponseCount += 1;
    }
    if (resource.contentEncoding) {
      encodings.add(resource.contentEncoding.toLowerCase());
    }
  }

  return {
    url: observedUrl.displayUrl,
    context: input.context,
    ttfbMs: difference(input.timing.responseStart, input.timing.requestStart),
    firstContentfulPaintMs: roundedNonNegative(input.timing.firstContentfulPaint),
    largestContentfulPaintMs: roundedNonNegative(input.timing.largestContentfulPaint),
    cumulativeLayoutShift: roundedNonNegative(input.timing.cumulativeLayoutShift),
    totalBlockingTimeMs: roundedNonNegative(input.timing.totalBlockingTime),
    navigationDurationMs: difference(
      input.timing.domContentLoadedEventEnd,
      input.timing.requestStart,
    ),
    totalRequestCount: input.resources.length,
    transferBytes: hasKnownTransferBytes ? transferBytes : null,
    transferBytesByCategory,
    cache: {
      responseCount: input.resources.length,
      cacheControlledResponseCount,
    },
    compression: {
      encodedResponseCount: encodings.size === 0 ? 0 : input.resources.filter((resource) => resource.contentEncoding !== null).length,
      encodings: [...encodings].sort(),
    },
  };
}
