import type { Page } from "playwright";
import type { BrowserLabTiming } from "./performance.js";

export type LabResourceTiming = {
  url: string;
  startMs: number | null;
  endMs: number | null;
  durationMs: number | null;
  transferBytes: number | null;
  encodedBodyBytes: number | null;
  decodedBodyBytes: number | null;
  sizeReason: string | null;
};
export type LabImageObservation = {
  url: string;
  naturalWidth: number;
  naturalHeight: number;
  displayedWidth: number;
  displayedHeight: number;
};
export type LabRuntimeDetails = {
  metricVersion: "2.0.0";
  windowStartMs: number;
  windowEndMs: number | null;
  support: { lcp: boolean; cls: boolean; longTasks: boolean; paint: boolean };
  limited: boolean;
  hidden: boolean;
  resourcesTruncated: boolean;
  longTaskCount: number;
  devicePixelRatio: number;
  resources: LabResourceTiming[];
  images: LabImageObservation[];
};
export type BrowserLabRuntimeSnapshot = {
  timing: BrowserLabTiming;
  userAgent: string;
  details?: LabRuntimeDetails;
};

// The key stays compatible with existing page adapters. Each navigation creates
// fresh state; no DOM text, event payload, cookie or long-task attribution is kept.
export const labObserverScript = `(() => {
  const key = "__agencyMonitorLabPerformanceV2";
  const support = { lcp: false, cls: false, longTasks: false, paint: false };
  const state = { lcp: null, cls: 0, blocking: 0, longTaskCount: 0, limited: false };
  const observers = [];
  let sessionStart = null, lastShift = null, sessionValue = 0, finished = false, windowEndMs = null;
  const valid = v => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const observe = (type, name, consume) => {
    try {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
      let count = 0;
      const accept = entries => {
        for (const entry of entries) {
          if (count >= 1000) { state.limited = true; observer.disconnect(); break; }
          count++;
          if (valid(entry.startTime)) consume(entry);
        }
      };
      const observer = new PerformanceObserver(list => accept(list.getEntries()));
      observer.observe({ type, buffered: true });
      support[name] = true;
      observers.push({ observer, accept });
    } catch {}
  };
  observe("largest-contentful-paint", "lcp", e => { state.lcp = e.startTime; });
  observe("layout-shift", "cls", e => {
    if (e.hadRecentInput || !valid(e.value)) return;
    if (lastShift !== null && e.startTime - lastShift < 1000 && e.startTime - sessionStart < 5000) sessionValue += e.value;
    else { sessionStart = e.startTime; sessionValue = e.value; }
    lastShift = e.startTime;
    state.cls = Math.max(state.cls, sessionValue);
  });
  observe("longtask", "longTasks", e => {
    if (!valid(e.duration)) return;
    state.blocking += Math.max(0, e.duration - 50);
    state.longTaskCount++;
  });
  observe("paint", "paint", () => {});
  try { performance.setResourceTimingBufferSize(120); } catch {}
  let resourceBufferFull = false;
  performance.addEventListener("resourcetimingbufferfull", () => { resourceBufferFull = true; }, { once: true });
  window[key] = {
    snapshot() {
      if (!finished) {
        windowEndMs = performance.now();
        for (const { observer, accept } of observers) { accept(observer.takeRecords()); observer.disconnect(); }
        finished = true;
      }
      const end = windowEndMs;
      const hidden = document.visibilityState !== "visible";
      const navigation = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const value = v => valid(v) ? v : null;
      const entries = performance.getEntriesByType("resource");
      const resources = [navigation, ...entries.slice(0, 119)].filter(Boolean).map(e => {
        const known = valid(e.transferSize) && e.transferSize > 0;
        const cached = e.transferSize === 0 && valid(e.decodedBodySize) && e.decodedBodySize > 0;
        return {
          url: e.name, startMs: value(e.startTime), endMs: value(e.responseEnd),
          durationMs: value(e.duration), transferBytes: known ? e.transferSize : null,
          encodedBodyBytes: known || cached ? value(e.encodedBodySize) : null,
          decodedBodyBytes: known || cached ? value(e.decodedBodySize) : null,
          sizeReason: known ? null : cached ? "cache-or-service-worker" : "zero-or-restricted-timing"
        };
      });
      const images = Array.from({length: Math.min(document.images.length, 20)}, (_, index) => document.images[index]).map(e => {
        const rect = e.getBoundingClientRect();
        return { url: e.currentSrc || e.src, naturalWidth: e.naturalWidth, naturalHeight: e.naturalHeight, displayedWidth: rect.width, displayedHeight: rect.height };
      });
      return {
        timing: {
          requestStart: value(navigation && navigation.requestStart),
          responseStart: value(navigation && navigation.responseStart),
          domContentLoadedEventEnd: value(navigation && navigation.domContentLoadedEventEnd),
          firstContentfulPaint: hidden ? null : value(fcp && fcp.startTime),
          largestContentfulPaint: hidden || !support.lcp ? null : value(state.lcp),
          cumulativeLayoutShift: hidden || !support.cls || end <= 0 ? null : state.cls,
          totalBlockingTime: null,
          observedThreadBlockingTime: support.longTasks && end > 0 ? state.blocking : null
        },
        userAgent: navigator.userAgent,
        details: {
          metricVersion: "2.0.0", windowStartMs: 0, windowEndMs: end, support,
          limited: state.limited, hidden,
          resourcesTruncated: resourceBufferFull || entries.length >= 120 || document.images.length > 20,
          longTaskCount: state.longTaskCount, devicePixelRatio: window.devicePixelRatio,
          resources, images
        }
      };
    }
  };
})();`;

function numberOrNull(value: unknown, max = 1e12): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
    ? value
    : null;
}
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 512);
  } catch {
    return null;
  }
}
export function performanceCollectionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.WEBPROBE_PERFORMANCE_COLLECTION !== "disabled";
}

export async function installLabPerformanceObserver(
  page: Page,
): Promise<boolean> {
  if (
    !performanceCollectionEnabled() ||
    typeof page.addInitScript !== "function"
  )
    return false;
  await page.addInitScript({ content: labObserverScript });
  return true;
}
export async function readLabPerformanceSnapshot(
  page: Page,
): Promise<BrowserLabRuntimeSnapshot | null> {
  if (!performanceCollectionEnabled() || typeof page.evaluate !== "function")
    return null;
  try {
    const raw = await page.evaluate<BrowserLabRuntimeSnapshot | null>(`(() => {
      const state = window.__agencyMonitorLabPerformanceV2;
      return state && typeof state.snapshot === "function" ? state.snapshot() : null;
    })()`);
    if (!raw || !raw.timing || typeof raw.userAgent !== "string") return null;
    const timing: BrowserLabTiming = {
      requestStart: numberOrNull(raw.timing.requestStart),
      responseStart: numberOrNull(raw.timing.responseStart),
      domContentLoadedEventEnd: numberOrNull(
        raw.timing.domContentLoadedEventEnd,
      ),
      firstContentfulPaint: numberOrNull(raw.timing.firstContentfulPaint),
      largestContentfulPaint: numberOrNull(raw.timing.largestContentfulPaint),
      cumulativeLayoutShift: numberOrNull(
        raw.timing.cumulativeLayoutShift,
        1000,
      ),
      totalBlockingTime: numberOrNull(raw.timing.totalBlockingTime),
      observedThreadBlockingTime: numberOrNull(
        raw.timing.observedThreadBlockingTime,
      ),
    };
    const d = raw.details;
    if (!d || d.metricVersion !== "2.0.0")
      return { timing, userAgent: raw.userAgent.slice(0, 192) };
    const details: LabRuntimeDetails = {
      metricVersion: "2.0.0",
      windowStartMs: 0,
      windowEndMs: numberOrNull(d.windowEndMs, 300_000),
      support: {
        lcp: d.support?.lcp === true,
        cls: d.support?.cls === true,
        longTasks: d.support?.longTasks === true,
        paint: d.support?.paint === true,
      },
      limited: d.limited === true,
      hidden: d.hidden === true,
      resourcesTruncated: d.resourcesTruncated === true,
      longTaskCount: Math.min(1000, numberOrNull(d.longTaskCount, 1000) ?? 0),
      devicePixelRatio: numberOrNull(d.devicePixelRatio, 10) ?? 1,
      resources: (Array.isArray(d.resources) ? d.resources : [])
        .slice(0, 120)
        .flatMap((r) => {
          const url = safeUrl(r?.url);
          if (!url) return [];
          return [
            {
              url,
              startMs: numberOrNull(r.startMs, 300_000),
              endMs: numberOrNull(r.endMs, 300_000),
              durationMs: numberOrNull(r.durationMs, 300_000),
              transferBytes: numberOrNull(r.transferBytes),
              encodedBodyBytes: numberOrNull(r.encodedBodyBytes),
              decodedBodyBytes: numberOrNull(r.decodedBodyBytes),
              sizeReason: [
                "cache-or-service-worker",
                "zero-or-restricted-timing",
              ].includes(r.sizeReason ?? "")
                ? r.sizeReason
                : null,
            },
          ];
        }),
      images: (Array.isArray(d.images) ? d.images : [])
        .slice(0, 20)
        .flatMap((i) => {
          const url = safeUrl(i?.url);
          if (!url) return [];
          return [
            {
              url,
              naturalWidth: numberOrNull(i.naturalWidth, 100000) ?? 0,
              naturalHeight: numberOrNull(i.naturalHeight, 100000) ?? 0,
              displayedWidth: numberOrNull(i.displayedWidth, 100000) ?? 0,
              displayedHeight: numberOrNull(i.displayedHeight, 100000) ?? 0,
            },
          ];
        }),
    };
    if (details.hidden || !details.support.cls)
      timing.cumulativeLayoutShift = null;
    if (details.hidden || !details.support.lcp)
      timing.largestContentfulPaint = null;
    if (!details.support.longTasks) timing.observedThreadBlockingTime = null;
    timing.totalBlockingTime = null;
    return { timing, userAgent: raw.userAgent.slice(0, 192), details };
  } catch {
    return null;
  }
}
