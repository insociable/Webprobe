import {
  performanceContentType,
  performanceCacheControl,
  performanceExpires,
  performanceContentEncoding,
} from "./performance-metadata.js";
import type { BrowserLabRuntimeSnapshot } from "./performance-runtime.js";

export type PerformanceResource = {
  url: string;
  type: string;
  inScope: boolean;
  blocked: boolean;
  failure: "outside-scope" | "request-failed" | null;
  statusCode: number | null;
  transferBytes: number | null;
  encodedBodyBytes: number | null;
  declaredBodyBytes: number | null;
  contentType: string | null;
  contentEncoding: string | null;
  compressionNegotiated: boolean | null;
  cacheControl: string | null;
  etagPresent: boolean | null;
  expires: string | null;
};
export type PerformanceFinding = {
  code: string;
  level: "review" | "information";
  summary: string;
  recommendation: string | null;
  observed?: string | number;
};
export type PerformanceContext = {
  pageUrl: string;
  measuredAt: string;
  viewport: { width: number; height: number };
  cacheState: "cold" | "unknown";
  networkPolicy: "standard" | "deep";
  excludedThirdPartyRequests: number;
  resourcesTruncated: boolean;
  observedResourceCount?: number;
};
function number(value: unknown, max = 1e12): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
    ? value
    : null;
}
function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 8192) return null;
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.toString().slice(0, 512);
  } catch {
    return null;
  }
}
function boundedText(value: unknown, max = 256): string | null {
  return typeof value === "string"
    ? value.replace(/[\r\n\x00-\x1f]/g, "").slice(0, max)
    : null;
}
export function analyzeObservedPerformance(input: {
  snapshot: BrowserLabRuntimeSnapshot | null;
  resources: readonly PerformanceResource[];
  context: PerformanceContext;
}) {
  const d = input.snapshot?.details;
  const valid =
    d?.metricVersion === "2.0.0" && d.windowEndMs !== null && d.windowEndMs > 0;
  const timing = input.snapshot?.timing;
  const retained = input.resources.slice(0, 120);
  const urls = retained.map((r) => safeUrl(r.url));
  const urlCounts = new Map<string, number>();
  for (const url of urls)
    if (url) urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1);
  const timings = new Map<
    string,
    NonNullable<BrowserLabRuntimeSnapshot["details"]>["resources"]
  >();
  for (const entry of (d?.resources ?? []).slice(0, 120)) {
    const url = safeUrl(entry.url);
    if (!url) continue;
    const group = timings.get(url) ?? [];
    group.push(entry);
    timings.set(url, group);
  }
  const resources = retained.flatMap((r, index) => {
    const url = urls[index];
    if (!url) return [];
    // Matching by sanitized URL can be ambiguous. Do not assign timing sizes
    // across two query variants or repeated requests.
    const entries = timings.get(url) ?? [];
    const rt =
      urlCounts.get(url) === 1 &&
      entries.length === 1 &&
      input.resources.length <= 120 &&
      !input.context.resourcesTruncated &&
      !d?.resourcesTruncated
        ? entries[0]
        : null;
    return [
      {
        url,
        type: boundedText(r.type, 32) ?? "other",
        inScope: r.inScope === true,
        blocked: r.blocked === true,
        failure: r.failure,
        statusCode: number(r.statusCode, 599),
        transferBytes: number(r.transferBytes) ?? number(rt?.transferBytes),
        encodedBodyBytes:
          number(r.encodedBodyBytes) ?? number(rt?.encodedBodyBytes),
        decodedBodyBytes: number(rt?.decodedBodyBytes),
        declaredBodyBytes: number(r.declaredBodyBytes),
        sizeReason: r.blocked
          ? (r.failure ?? "blocked")
          : (rt?.sizeReason ??
            (r.transferBytes === null ? "size-unavailable" : null)),
        startMs: number(rt?.startMs, 300000),
        endMs: number(rt?.endMs, 300000),
        durationMs: number(rt?.durationMs, 300000),
        contentType: performanceContentType(r.contentType),
        contentEncoding: performanceContentEncoding(r.contentEncoding),
        compressionNegotiated: r.compressionNegotiated,
        cacheControl: performanceCacheControl(r.cacheControl),
        etagPresent: r.etagPresent,
        expires: performanceExpires(r.expires),
      },
    ];
  });
  const reasons: string[] = [];
  if (!valid) reasons.push("measurement-unavailable");
  if (d?.hidden) reasons.push("page-hidden");
  if (d?.limited) reasons.push("observer-entry-limit");
  if (
    d?.resourcesTruncated ||
    input.context.resourcesTruncated ||
    input.resources.length > 120
  )
    reasons.push("resource-collection-limit");
  const blockedCount = resources.filter((r) => r.blocked).length;
  if (
    resources.some(
      (r) => !r.blocked && (r.transferBytes === null || r.statusCode === null),
    )
  )
    reasons.push("resource-size-unavailable");
  if (input.context.excludedThirdPartyRequests > 0 || blockedCount > 0)
    reasons.push("blocked-resources");
  if (
    valid &&
    (!d.support.lcp ||
      !d.support.cls ||
      !d.support.longTasks ||
      !d.support.paint)
  )
    reasons.push("unsupported-performance-api");
  if (
    valid &&
    (timing?.firstContentfulPaint === null ||
      timing?.largestContentfulPaint === null)
  )
    reasons.push("paint-not-observed");
  const metric = (value: unknown, unavailable: string) => {
    const v = valid ? number(value) : null;
    return { value: v, reason: v === null ? unavailable : null };
  };
  const requestStart = number(timing?.requestStart);
  const responseStart = number(timing?.responseStart);
  const metrics = {
    ttfbMs: metric(
      requestStart !== null &&
        responseStart !== null &&
        responseStart >= requestStart
        ? responseStart - requestStart
        : null,
      "navigation-timing-unavailable",
    ),
    fcpMs: metric(
      timing?.firstContentfulPaint,
      d?.support.paint ? "paint-not-observed" : "api-unavailable",
    ),
    lcpMs: metric(
      timing?.largestContentfulPaint,
      d?.support.lcp ? "candidate-not-observed" : "api-unavailable",
    ),
    cls: metric(
      timing?.cumulativeLayoutShift,
      d?.support.cls ? "window-unavailable" : "api-unavailable",
    ),
    observedThreadBlockingMs: metric(
      timing?.observedThreadBlockingTime,
      "api-or-window-unavailable",
    ),
    inpMs: { value: null, reason: "no-user-interaction" },
  };
  if (valid && metrics.ttfbMs.value === null)
    reasons.push("navigation-timing-unavailable");
  if (
    valid &&
    (metrics.cls.value === null ||
      metrics.observedThreadBlockingMs.value === null)
  )
    reasons.push("metric-unavailable");
  const findings: PerformanceFinding[] = [];
  const add = (
    code: string,
    summary: string,
    recommendation: string,
    observed: number,
  ) =>
    findings.push({ code, level: "review", summary, recommendation, observed });
  if (metrics.lcpMs.value !== null && metrics.lcpMs.value > 2500)
    add(
      "performance-lcp-observed",
      "Le contenu principal apparaît tard dans la fenêtre observée.",
      "Examiner la ressource du contenu principal et les scripts/styles critiques avant de comparer un nouveau scan dans le même contexte.",
      metrics.lcpMs.value,
    );
  if (metrics.cls.value !== null && metrics.cls.value > 0.1)
    add(
      "performance-layout-shifts",
      "Des déplacements de contenu ont été observés.",
      "Réserver l’espace des images et contenus différés, puis vérifier la stabilité sur la même page.",
      metrics.cls.value,
    );
  if (
    metrics.observedThreadBlockingMs.value !== null &&
    metrics.observedThreadBlockingMs.value > 300
  )
    add(
      "performance-thread-blocking",
      "Des tâches longues ont bloqué le thread pendant la fenêtre observée.",
      "Réduire ou découper le JavaScript exécuté au chargement. Cette mesure n’est ni un INP ni un TBT Lighthouse.",
      metrics.observedThreadBlockingMs.value,
    );
  let compressionEligible = 0,
    compressionEvaluated = 0,
    compressionMissing = 0;
  let cacheEligible = 0;
  let cacheEvaluated = 0,
    cacheReview = 0;
  for (const r of resources) {
    if (
      !r.inScope ||
      r.blocked ||
      r.statusCode === null ||
      r.statusCode < 200 ||
      r.statusCode >= 300
    )
      continue;
    const text =
      r.contentType !== null &&
      (/^text\//.test(r.contentType) ||
        /^(?:application\/(?:javascript|x-javascript|json|[^/;]+\+json|xml|[^/;]+\+xml)|image\/svg\+xml)$/.test(
          r.contentType,
        ));
    const bodyBytes = r.decodedBodyBytes ?? r.encodedBodyBytes;
    if (text && bodyBytes !== null && bodyBytes >= 1024) {
      compressionEligible++;
      if (
        r.contentEncoding &&
        /^(br|gzip|deflate|zstd)$/.test(r.contentEncoding)
      )
        compressionEvaluated++;
      else if (
        (r.contentEncoding === null || r.contentEncoding === "identity") &&
        r.compressionNegotiated === true
      ) {
        compressionEvaluated++;
        compressionMissing++;
      }
    }
    if (!["script", "stylesheet", "image", "font"].includes(r.type)) continue;
    // Static resources alone: personalized HTML/XHR and explicit sensitive
    // policies are never encouraged to become public.
    cacheEligible++;
    const cc = r.cacheControl;
    if (
      cc === "policy-unrecognized" ||
      (cc === null && r.etagPresent === null && r.expires === null)
    )
      continue;
    cacheEvaluated++;
    if (cc && /(?:^|,)\s*(?:private|no-store|no-cache)\b/i.test(cc)) continue;
    const age = cc ? /(?:^|,)\s*max-age\s*=\s*"?([0-9]+)"?/i.exec(cc) : null;
    const fresh = age !== null && Number(age[1]) > 0;
    const validExpires =
      r.expires !== null &&
      Number.isFinite(Date.parse(r.expires)) &&
      Date.parse(r.expires) > Date.parse(input.context.measuredAt);
    if (!fresh && !validExpires && r.etagPresent !== true) cacheReview++;
  }
  if (compressionMissing)
    add(
      "performance-text-compression",
      "Des réponses texte volumineuses négociées n’étaient pas compressées.",
      "Activer une compression adaptée pour ces contenus texte ; vérifier la négociation et le coût CPU. Les images et archives déjà compressées sont exclues.",
      compressionMissing,
    );
  if (cacheReview)
    add(
      "performance-static-cache",
      "Des ressources statiques n’avaient ni fraîcheur ni validateur observé.",
      "Définir une politique de cache adaptée à leur versionnement et confidentialité ; max-age peut suffire sans ETag.",
      cacheReview,
    );
  const images = (d?.images ?? []).slice(0, 20).flatMap((i) => {
    const url = safeUrl(i.url);
    if (!url) return [];
    const resource = resources.find((r) => r.url === url && !r.blocked);
    const ratio =
      i.displayedWidth > 0 && i.displayedHeight > 0
        ? Math.min(
            i.naturalWidth / (i.displayedWidth * (d?.devicePixelRatio ?? 1)),
            i.naturalHeight / (i.displayedHeight * (d?.devicePixelRatio ?? 1)),
          )
        : null;
    return [
      {
        ...i,
        url,
        contentType: resource?.contentType ?? null,
        encodedBodyBytes: resource?.encodedBodyBytes ?? null,
        oversizeRatio: number(ratio, 100000),
      },
    ];
  });
  const oversized = images.filter(
    (i) =>
      i.oversizeRatio !== null &&
      i.oversizeRatio > 2 &&
      i.encodedBodyBytes !== null &&
      i.encodedBodyBytes > 100000,
  ).length;
  if (oversized)
    add(
      "performance-oversized-images",
      "Des images lourdes dépassent largement leur taille d’affichage.",
      "Adapter les dimensions et la qualité aux usages et au ratio de pixels ; choisir le format selon le contenu sans imposer un format unique.",
      oversized,
    );
  const totals = (
    key:
      | "transferBytes"
      | "encodedBodyBytes"
      | "decodedBodyBytes"
      | "declaredBodyBytes",
  ) => {
    const known = resources.filter((r) => r[key] !== null && !r.blocked);
    return {
      knownBytes: known.length
        ? known.reduce((sum, r) => sum + (r[key] ?? 0), 0)
        : null,
      knownCount: known.length,
      observedCount: resources.length,
    };
  };
  const origins = new Map<
    string,
    {
      origin: string;
      knownTransferBytes: number | null;
      knownSizeCount: number;
      resourceCount: number;
      firstStartMs: number | null;
      lastEndMs: number | null;
    }
  >();
  for (const r of resources) {
    const origin = new URL(r.url).origin;
    if (!origins.has(origin) && origins.size >= 12) continue;
    const group = origins.get(origin) ?? {
      origin,
      knownTransferBytes: null,
      knownSizeCount: 0,
      resourceCount: 0,
      firstStartMs: null,
      lastEndMs: null,
    };
    group.resourceCount++;
    if (r.transferBytes !== null && !r.blocked) {
      group.knownTransferBytes =
        (group.knownTransferBytes ?? 0) + r.transferBytes;
      group.knownSizeCount++;
    }
    if (r.startMs !== null)
      group.firstStartMs = Math.min(group.firstStartMs ?? r.startMs, r.startMs);
    if (r.endMs !== null)
      group.lastEndMs = Math.max(group.lastEndMs ?? r.endMs, r.endMs);
    origins.set(origin, group);
  }
  const coverage = !valid
    ? "unavailable"
    : reasons.length
      ? "limited"
      : "observed";
  return {
    title: "Performance observée",
    summary:
      "Mesures de laboratoire dans l’environnement WebProbe, limitées à la page et à la fenêtre observées.",
    coverage,
    metricVersion: "2.0.0",
    pageUrl: safeUrl(input.context.pageUrl),
    measuredAt: input.context.measuredAt,
    context: {
      viewport: input.context.viewport,
      browser: input.snapshot?.userAgent.slice(0, 192) ?? null,
      cacheState: input.context.cacheState,
      windowStartMs: 0,
      windowEndMs: d?.windowEndMs ?? null,
      ttfbDefinition:
        "responseStart − requestStart (requête du document, hors DNS/connexion précédents)",
      clsDefinition:
        "Maximum des fenêtres de session : intervalle < 1 s, durée < 5 s, sans interaction récente.",
      blockingDefinition:
        "Somme de max(0, durée − 50 ms) des tâches longues, navigation → fin d’observation ; pas TBT Lighthouse.",
      network:
        input.context.networkPolicy === "deep"
          ? "Proxy gardé, origine canonique autorisée, tiers hors périmètre bloqués ; VM et proxy influencent les mesures."
          : "Scan standard : les ressources tierces peuvent être chargées par le navigateur ; les mesures peuvent les inclure. Le réseau et la VM influencent les résultats.",
    },
    metrics,
    findings,
    reasons,
    excludedThirdPartyRequests: input.context.excludedThirdPartyRequests,
    resources: {
      observedCount:
        input.context.observedResourceCount ?? input.resources.length,
      retainedCount: resources.length,
      blockedCount,
      transfer: totals("transferBytes"),
      encodedBody: totals("encodedBodyBytes"),
      decodedBody: totals("decodedBodyBytes"),
      declaredBody: totals("declaredBodyBytes"),
      heavy: resources
        .filter((r) => !r.blocked && r.encodedBodyBytes !== null)
        .sort((a, b) => (b.encodedBodyBytes ?? 0) - (a.encodedBodyBytes ?? 0))
        .slice(0, 10),
      criticalTimeline: resources
        .filter((r) =>
          ["document", "script", "stylesheet", "font"].includes(r.type),
        )
        .slice(0, 20)
        .map((r) => ({
          url: r.url,
          type: r.type,
          startMs: r.startMs,
          endMs: r.endMs,
          durationMs: r.durationMs,
          blocked: r.blocked,
        })),
      origins: [...origins.values()],
    },
    compression: {
      eligibleCount: compressionEligible,
      evaluatedCount: compressionEvaluated,
      uncompressedCount: compressionMissing,
      unavailableCount: compressionEligible - compressionEvaluated,
    },
    cache: {
      eligibleCount: cacheEligible,
      evaluatedCount: cacheEvaluated,
      reviewCount: cacheReview,
      unavailableCount: cacheEligible - cacheEvaluated,
    },
    images,
  };
}
