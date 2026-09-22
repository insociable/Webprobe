import type { Page } from "playwright";
import type { BrowserLabTiming } from "./performance.js";

const performanceStateKey = "__agencyMonitorLabPerformanceV2";

const observerScript = `(() => {
  const key = ${JSON.stringify(performanceStateKey)};
  const state = { lcp: null, cls: 0, tbt: 0 };
  window[key] = state;
  const observe = (type, callback) => {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) callback(entry, state);
      }).observe({ type, buffered: true });
    } catch { /* unsupported browser entry type */ }
  };
  observe("largest-contentful-paint", (entry, target) => { target.lcp = entry.startTime; });
  observe("layout-shift", (entry, target) => {
    if (!entry.hadRecentInput) target.cls += entry.value;
  });
  observe("longtask", (entry, target) => { target.tbt += Math.max(0, entry.duration - 50); });
})();`;

type PageWithPerformanceMethods = Page & {
  addInitScript?: (script: { content: string }) => Promise<void>;
  evaluate?: <T>(expression: string) => Promise<T>;
};

export async function installLabPerformanceObserver(
  page: Page,
): Promise<boolean> {
  const compatiblePage = page as PageWithPerformanceMethods;
  if (!compatiblePage.addInitScript) {
    return false;
  }
  await compatiblePage.addInitScript({ content: observerScript });
  return true;
}

export type BrowserLabRuntimeSnapshot = {
  timing: BrowserLabTiming;
  userAgent: string;
};

export async function readLabPerformanceSnapshot(
  page: Page,
): Promise<BrowserLabRuntimeSnapshot | null> {
  const compatiblePage = page as PageWithPerformanceMethods;
  if (!compatiblePage.evaluate) {
    return null;
  }

  try {
    return await compatiblePage.evaluate<BrowserLabRuntimeSnapshot>(`(() => {
      const numberOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
      const navigation = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const state = window[${JSON.stringify(performanceStateKey)}] || {};
      return {
        timing: {
          requestStart: numberOrNull(navigation && navigation.requestStart),
          responseStart: numberOrNull(navigation && navigation.responseStart),
          domContentLoadedEventEnd: numberOrNull(navigation && navigation.domContentLoadedEventEnd),
          firstContentfulPaint: numberOrNull(fcp && fcp.startTime),
          largestContentfulPaint: numberOrNull(state.lcp),
          cumulativeLayoutShift: numberOrNull(state.cls),
          totalBlockingTime: numberOrNull(state.tbt),
        },
        userAgent: navigator.userAgent,
      };
    })()`);
  } catch {
    return null;
  }
}
