import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  labObserverScript,
  performanceCollectionEnabled,
  installLabPerformanceObserver,
  readLabPerformanceSnapshot,
  type BrowserLabRuntimeSnapshot,
} from "../src/scanner-v2/performance-runtime.js";
import {
  analyzeObservedPerformance,
  type PerformanceResource,
} from "../src/scanner-v2/performance-analysis.js";
import { createPerformanceCheck } from "../src/scan-engine/performance-check.js";
import type { Page } from "playwright";

function runtime(
  types = ["largest-contentful-paint", "layout-shift", "longtask", "paint"],
) {
  const callbacks = new Map<string, (entries: unknown[]) => void>();
  const pending = new Map<string, unknown[]>();
  let clock = 7000;
  const win: Record<string, { snapshot: () => BrowserLabRuntimeSnapshot }> = {};
  class Observer {
    static supportedEntryTypes = types;
    type = "";
    constructor(private cb: (list: { getEntries: () => unknown[] }) => void) {}
    observe({ type }: { type: string }) {
      this.type = type;
      callbacks.set(type, (entries) => this.cb({ getEntries: () => entries }));
    }
    takeRecords() {
      return pending.get(this.type) ?? [];
    }
    disconnect() {}
  }
  vm.runInNewContext(labObserverScript, {
    window: win,
    document: { visibilityState: "visible", images: [] },
    navigator: { userAgent: "Fixture" },
    PerformanceObserver: Observer,
    performance: {
      now: () => clock,
      setResourceTimingBufferSize() {},
      addEventListener() {},
      getEntriesByType: (type: string) =>
        type === "navigation"
          ? [
              {
                name: "https://example.test/",
                requestStart: 20,
                responseStart: 120,
                domContentLoadedEventEnd: 200,
              },
            ]
          : [],
      getEntriesByName: () => [{ startTime: 80 }],
    },
  });
  return {
    emit: (type: string, entries: unknown[]) => callbacks.get(type)?.(entries),
    pending,
    snapshot: () => win.__agencyMonitorLabPerformanceV2!.snapshot(),
    clock: (v: number) => {
      clock = v;
    },
  };
}
const context = {
  pageUrl: "https://example.test/?private=secret",
  measuredAt: "2026-10-12T16:00:00Z",
  viewport: { width: 1280, height: 720 },
  cacheState: "cold" as const,
  networkPolicy: "deep" as const,
  excludedThirdPartyRequests: 0,
  resourcesTruncated: false,
};
function snapshot(): BrowserLabRuntimeSnapshot {
  const r = runtime();
  r.emit("largest-contentful-paint", [{ startTime: 800 }]);
  return r.snapshot();
}
function resource(
  extra: Partial<PerformanceResource> = {},
): PerformanceResource {
  return {
    url: "https://example.test/app.js?private=secret",
    type: "script",
    inScope: true,
    blocked: false,
    failure: null,
    statusCode: 200,
    transferBytes: 2500,
    encodedBodyBytes: 2000,
    declaredBodyBytes: 9000,
    contentType: "application/javascript",
    contentEncoding: null,
    compressionNegotiated: true,
    cacheControl: "max-age=31536000, immutable",
    etagPresent: false,
    expires: null,
    ...extra,
  };
}
describe("observed performance semantics", () => {
  it("allows a server-only functional rollback without presenting missing collection as success", async () => {
    expect(performanceCollectionEnabled({})).toBe(true);
    expect(
      performanceCollectionEnabled({
        WEBPROBE_PERFORMANCE_COLLECTION: "disabled",
      }),
    ).toBe(false);
    const before = process.env.WEBPROBE_PERFORMANCE_COLLECTION;
    process.env.WEBPROBE_PERFORMANCE_COLLECTION = "disabled";
    try {
      const page = {
        addInitScript: () => {
          throw new Error("Unexpected instrumentation");
        },
        evaluate: () => {
          throw new Error("Unexpected evaluation");
        },
      } as unknown as Page;
      expect(await installLabPerformanceObserver(page)).toBe(false);
      expect(await readLabPerformanceSnapshot(page)).toBeNull();
      const [e] = await createPerformanceCheck().analyze(
        { browser: { deep: { performanceCollectionEnabled: false } } },
        new AbortController().signal,
      );
      expect(e?.data).toMatchObject({
        coverage: "unavailable",
        reasons: ["collection-disabled"],
      });
    } finally {
      if (before === undefined)
        delete process.env.WEBPROBE_PERFORMANCE_COLLECTION;
      else process.env.WEBPROBE_PERFORMANCE_COLLECTION = before;
    }
  });

  it("distinguishes standard third-party traffic from Deep network restrictions", () => {
    const standard = analyzeObservedPerformance({
      snapshot: snapshot(),
      resources: [resource({ url: "https://cdn.example.test/library.js" })],
      context: { ...context, networkPolicy: "standard" },
    });
    const deep = analyzeObservedPerformance({
      snapshot: snapshot(),
      resources: [resource()],
      context,
    });
    expect(standard.context.network).toContain(
      "ressources tierces peuvent être chargées",
    );
    expect(standard.context.network).not.toContain(
      "tiers hors périmètre bloqués",
    );
    expect(deep.context.network).toContain("tiers hors périmètre bloqués");
  });

  it("keeps unknown or chained encodings non-evaluable and preserves raw-header privacy", () => {
    const data = analyzeObservedPerformance({
      snapshot: snapshot(),
      resources: [
        resource({
          contentEncoding: "custom-secret",
          cacheControl: "custom=hidden",
        }),
      ],
      context,
    });
    expect(data.compression).toMatchObject({
      evaluatedCount: 0,
      uncompressedCount: 0,
      unavailableCount: 1,
    });
    expect(data.cache).toMatchObject({
      evaluatedCount: 0,
      unavailableCount: 1,
    });
    expect(JSON.stringify(data)).not.toContain("custom-secret");
    expect(JSON.stringify(data)).not.toContain("custom=hidden");
  });

  it("uses maximum CLS session, ignores recent input and retains the latest LCP", () => {
    const r = runtime();
    r.emit("layout-shift", [
      { startTime: 0, value: 0.1 },
      { startTime: 500, value: 0.15 },
      { startTime: 2000, value: 0.4 },
      { startTime: 2100, value: 2, hadRecentInput: true },
    ]);
    r.emit("largest-contentful-paint", [
      { startTime: 100 },
      { startTime: 800 },
    ]);
    r.emit("longtask", [
      { startTime: 20, duration: 80 },
      { startTime: 200, duration: 100 },
    ]);
    expect(r.snapshot().timing).toMatchObject({
      cumulativeLayoutShift: 0.4,
      largestContentfulPaint: 800,
      observedThreadBlockingTime: 80,
      totalBlockingTime: null,
    });
  });
  it("splits CLS at exactly one second and at the five-second boundary", () => {
    const r = runtime();
    r.emit("layout-shift", [
      { startTime: 0, value: 0.2 },
      { startTime: 1000, value: 0.3 },
      ...[1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500].map(
        (startTime) => ({ startTime, value: 0.01 }),
      ),
      { startTime: 6000, value: 0.5 },
    ]);
    expect(r.snapshot().timing.cumulativeLayoutShift).toBe(0.5);
  });
  it("drains pending entries, finalizes once and distinguishes unsupported APIs from observed zero", () => {
    const r = runtime();
    r.pending.set("longtask", [{ startTime: 1, duration: 90 }]);
    expect(r.snapshot().timing.observedThreadBlockingTime).toBe(40);
    r.clock(9000);
    expect(r.snapshot().details?.windowEndMs).toBe(7000);
    expect(runtime().snapshot().timing.cumulativeLayoutShift).toBe(0);
    expect(runtime([]).snapshot().timing).toMatchObject({
      cumulativeLayoutShift: null,
      observedThreadBlockingTime: null,
      largestContentfulPaint: null,
    });
  });
  it("bounds observer input and reports saturation instead of claiming completeness", () => {
    const r = runtime();
    r.emit(
      "layout-shift",
      Array.from({ length: 1002 }, (_, i) => ({ startTime: i, value: 0.001 })),
    );
    expect(r.snapshot().details?.limited).toBe(true);
  });
  it("sanitizes browser timing URLs and rejects nonfinite and oversized values", async () => {
    const raw = snapshot();
    raw.details!.resources = [
      {
        url: "https://u:pass@example.test/x?token=secret#hash",
        startMs: 0,
        endMs: 100,
        durationMs: NaN,
        transferBytes: Infinity,
        encodedBodyBytes: null,
        decodedBodyBytes: null,
        sizeReason: "zero-or-restricted-timing",
      },
    ];
    const page = { evaluate: async () => raw } as unknown as Page;
    const clean = await readLabPerformanceSnapshot(page);
    expect(clean?.details?.resources[0]).toMatchObject({
      url: "https://example.test/x",
      durationMs: null,
      transferBytes: null,
    });
    expect(JSON.stringify(clean)).not.toMatch(/secret|pass/);
  });
  it("keeps INP unavailable, separates transferred/declared bytes and strips parameters", () => {
    const data = analyzeObservedPerformance({
      snapshot: snapshot(),
      resources: [resource()],
      context,
    });
    expect(data.metrics.inpMs).toEqual({
      value: null,
      reason: "no-user-interaction",
    });
    expect(data.metrics.ttfbMs.value).toBe(100);
    expect(data.resources.transfer.knownBytes).toBe(2500);
    expect(data.resources.declaredBody.knownBytes).toBe(9000);
    expect(JSON.stringify(data)).not.toContain("secret");
  });
  it("evaluates negotiated large text only and respects sensitive/fresh cache policies", () => {
    const rows = [
      resource(),
      resource({
        url: "https://example.test/small.css",
        type: "stylesheet",
        encodedBodyBytes: 500,
      }),
      resource({
        url: "https://example.test/a.webp",
        type: "image",
        contentType: "image/webp",
        encodedBodyBytes: 500000,
        cacheControl: "private, no-store",
      }),
      resource({
        url: "https://example.test/b.js",
        contentEncoding: "br",
        cacheControl: 'max-age="3600"',
      }),
      resource({
        url: "https://example.test/c.js",
        compressionNegotiated: null,
        cacheControl: "no-cache",
      }),
      resource({
        url: "https://example.test/private",
        type: "document",
        cacheControl: null,
      }),
    ];
    const d = analyzeObservedPerformance({
      snapshot: snapshot(),
      resources: rows,
      context,
    });
    expect(d.compression).toEqual({
      eligibleCount: 4,
      evaluatedCount: 3,
      uncompressedCount: 2,
      unavailableCount: 1,
    });
    expect(d.findings.map((f) => f.code)).not.toContain(
      "performance-static-cache",
    );
    expect(d.cache.reviewCount).toBe(0);
  });
  it("reports unobservable sizes and blocked tiers as limited without manufacturing a favorable metric", () => {
    const d = analyzeObservedPerformance({
      snapshot: snapshot(),
      resources: [
        resource({
          blocked: true,
          failure: "outside-scope",
          inScope: false,
          transferBytes: null,
          encodedBodyBytes: null,
          declaredBodyBytes: null,
        }),
      ],
      context: { ...context, excludedThirdPartyRequests: 1 },
    });
    expect(d.coverage).toBe("limited");
    expect(d.resources.transfer.knownBytes).toBeNull();
    expect(d.resources.blockedCount).toBe(1);
    expect(d.reasons).toContain("blocked-resources");
    expect(
      analyzeObservedPerformance({ snapshot: null, resources: [], context })
        .coverage,
    ).toBe("unavailable");
  });
  it("keeps origin timing as intervals, bounds output and avoids assigning an ambiguous zero size", () => {
    const s = snapshot();
    s.details!.resources = [
      {
        url: "https://example.test/a",
        startMs: 10,
        endMs: 100,
        durationMs: 90,
        transferBytes: null,
        encodedBodyBytes: null,
        decodedBodyBytes: null,
        sizeReason: "zero-or-restricted-timing",
      },
      {
        url: "https://example.test/b",
        startMs: 20,
        endMs: 80,
        durationMs: 60,
        transferBytes: null,
        encodedBodyBytes: null,
        decodedBodyBytes: null,
        sizeReason: "zero-or-restricted-timing",
      },
    ];
    const d = analyzeObservedPerformance({
      snapshot: s,
      resources: [
        resource({
          url: "https://example.test/a",
          transferBytes: null,
          encodedBodyBytes: null,
        }),
        resource({
          url: "https://example.test/b",
          transferBytes: null,
          encodedBodyBytes: null,
        }),
      ],
      context,
    });
    expect(d.resources.origins[0]).toMatchObject({
      firstStartMs: 10,
      lastEndMs: 100,
      knownTransferBytes: null,
    });
    const large = analyzeObservedPerformance({
      snapshot: s,
      resources: Array.from({ length: 200 }, (_, i) =>
        resource({ url: "https://example.test/" + i }),
      ),
      context,
    });
    expect(large.resources.retainedCount).toBe(120);
    expect(large.resources.heavy.length).toBe(10);
    expect(large.coverage).toBe("limited");
    expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThan(20000);
  });
  it("returns unavailable evidence for an uninstrumented browser and respects abort", async () => {
    const check = createPerformanceCheck();
    const [e] = await check.analyze(
      { browser: { pageCount: 1 } },
      new AbortController().signal,
    );
    expect(e?.data.coverage).toBe("unavailable");
    const c = new AbortController();
    c.abort();
    await expect(check.analyze({}, c.signal)).rejects.toThrow("aborted");
  });
});
