import {
  ScanJobSchema,
  ScanResultSchema,
  type ScanJob,
  type ScanResult,
} from "@agency-saas/contracts";
import { generateBrowserFindings } from "./browser-findings.js";
import {
  runBrowserScan as defaultRunBrowserScan,
  type BrowserScanResult,
} from "./browser-scan.js";
import { generateHttpProbeFindings } from "./findings.js";
import {
  probeHttpTarget as defaultProbeHttpTarget,
  type HttpProbeResult,
} from "./http-probe.js";
import {
  markScanRunning,
  persistScanCompletion,
  persistScanFailure,
  validateScanContext,
} from "./scan-persistence.js";

export type ScanExecutionResult = ScanResult & {
  http: HttpProbeResult;
};

export type ScanProcessorDependencies = {
  probeHttpTarget?: typeof defaultProbeHttpTarget;
  runBrowserScan?: typeof defaultRunBrowserScan;
};

function isHtmlDocument(
  probe: Extract<HttpProbeResult, { ok: true }>,
): boolean {
  const contentType = probe.headers["content-type"]?.toLowerCase();
  return (
    probe.statusCode < 400 &&
    (contentType?.includes("text/html") === true ||
      contentType?.includes("application/xhtml+xml") === true)
  );
}

export async function processScanJob(
  jobData: ScanJob | unknown,
  dependencies: ScanProcessorDependencies = {},
): Promise<ScanExecutionResult> {
  const payload = ScanJobSchema.parse(jobData);
  const context = await validateScanContext(payload);
  const probeHttpTarget =
    dependencies.probeHttpTarget ?? defaultProbeHttpTarget;
  const runBrowserScan = dependencies.runBrowserScan ?? defaultRunBrowserScan;

  await markScanRunning(context);

  try {
    const httpProbe = await probeHttpTarget(context.targetUrl);
    const httpFindings = generateHttpProbeFindings(
      httpProbe,
      context.targetUrl,
    );
    let browserScan: BrowserScanResult | null = null;

    if (httpProbe.ok && isHtmlDocument(httpProbe)) {
      browserScan = await runBrowserScan(context.targetUrl, {
        maxPages: payload.profile.maxPages,
        navigationTimeoutMs: payload.profile.navigationTimeoutMs,
        checkAccessibility: payload.profile.checkAccessibility,
      });
    }

    const generatedFindings = [
      ...new Map(
        [
          ...httpFindings,
          ...(browserScan
            ? generateBrowserFindings(browserScan.observations)
            : []),
        ].map((finding) => [finding.fingerprint, finding]),
      ).values(),
    ];
    const completedAt = new Date();

    const result = ScanResultSchema.parse({
      scanId: context.scanId,
      startedAt: context.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      status: "completed",
      pagesVisited: browserScan?.pagesVisited ?? (httpProbe.ok ? 1 : 0),
      findings: generatedFindings.map((item) => ({
        category: item.category,
        severity: item.severity,
        code: item.code,
        title: item.title,
        pageUrl: item.pageUrl,
        evidence: item.evidence,
      })),
    });

    await persistScanCompletion(context, result, httpProbe, generatedFindings);

    return {
      ...result,
      http: httpProbe,
    };
  } catch (error) {
    try {
      await persistScanFailure(context, error);
    } catch {
      // Keep the original worker error as the BullMQ failure cause.
    }
    throw error;
  }
}
