import type { NetworkResourceObservation } from "./network.js";
import { observeUrl } from "./url.js";
import { analyzeObservedPerformance } from "./performance-analysis.js";
import type { BrowserLabRuntimeSnapshot } from "./performance-runtime.js";

export type LabResourceCategory =
  | "javascript"
  | "css"
  | "images"
  | "fonts"
  | "other";
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
  observedThreadBlockingTime?: number | null;
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
  observedThreadBlockingTimeMs?: number | null;
  metricVersion?: "2.0.0";
  measurement?: ReturnType<typeof analyzeObservedPerformance>;
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

function categoryFor(
  resourceType: NetworkResourceObservation["resourceType"],
): LabResourceCategory {
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
  snapshot?: BrowserLabRuntimeSnapshot;
  collectionLimited?: boolean;
  failedResources?: Array<{ resourceUrl: string; resourceType: string }>;
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
    if (resource.cacheControlled) {
      cacheControlledResponseCount += 1;
    }
    if (resource.contentEncoding) {
      encodings.add(resource.contentEncoding.toLowerCase());
    }
  }

  return {
    url: observedUrl.displayUrl,
    ...(input.snapshot?.details
      ? {
          metricVersion: "2.0.0" as const,
          observedThreadBlockingTimeMs: roundedNonNegative(
            input.timing.observedThreadBlockingTime ?? null,
          ),
          measurement: analyzeObservedPerformance({
            snapshot: input.snapshot,
            resources: [
              ...input.resources.map((r) => ({
                url: r.resourceUrl,
                type: r.resourceType,
                inScope: true,
                blocked: false,
                failure: null,
                statusCode: r.statusCode,
                transferBytes: r.transferBytes,
                encodedBodyBytes: r.encodedBodyBytes ?? null,
                declaredBodyBytes: r.declaredBodyBytes ?? null,
                contentType: r.contentType ?? null,
                contentEncoding: r.contentEncoding,
                compressionNegotiated: r.compressionNegotiated ?? null,
                cacheControl: r.cacheControl ?? null,
                etagPresent: r.etagPresent ?? null,
                expires: r.expires ?? null,
              })),
              ...(input.failedResources ?? []).slice(0, 120).map((r) => ({
                url: r.resourceUrl,
                type: r.resourceType,
                inScope: true,
                blocked: true,
                failure: "request-failed" as const,
                statusCode: null,
                transferBytes: null,
                encodedBodyBytes: null,
                declaredBodyBytes: null,
                contentType: null,
                contentEncoding: null,
                compressionNegotiated: null,
                cacheControl: null,
                etagPresent: null,
                expires: null,
              })),
            ],
            context: {
              pageUrl: observedUrl.displayUrl,
              measuredAt: input.context.measuredAt,
              viewport: input.context.viewport,
              cacheState: "unknown",
              networkPolicy: "standard",
              excludedThirdPartyRequests: 0,
              resourcesTruncated: input.collectionLimited === true,
            },
          }),
        }
      : {}),
    context: input.context,
    ttfbMs: difference(input.timing.responseStart, input.timing.requestStart),
    firstContentfulPaintMs: roundedNonNegative(
      input.timing.firstContentfulPaint,
    ),
    largestContentfulPaintMs: roundedNonNegative(
      input.timing.largestContentfulPaint,
    ),
    cumulativeLayoutShift:
      input.snapshot?.details &&
      typeof input.timing.cumulativeLayoutShift === "number" &&
      Number.isFinite(input.timing.cumulativeLayoutShift) &&
      input.timing.cumulativeLayoutShift >= 0
        ? Math.round(input.timing.cumulativeLayoutShift * 1_000_000) / 1_000_000
        : roundedNonNegative(input.timing.cumulativeLayoutShift),
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
      encodedResponseCount:
        encodings.size === 0
          ? 0
          : input.resources.filter(
              (resource) => resource.contentEncoding !== null,
            ).length,
      encodings: [...encodings].sort(),
    },
  };
}
