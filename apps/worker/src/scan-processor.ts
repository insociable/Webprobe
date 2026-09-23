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
import { persistPrimaryScreenshot as defaultPersistPrimaryScreenshot } from "./scan-artifacts.js";
import {
  generateScannerV2Findings,
  summarizeScannerV2,
  type ScannerV2PersistentSummary,
} from "./scanner-v2/findings.js";
import {
  markScanRunning,
  persistScanCompletion,
  persistScanFailureForJob,
  validateScanContext,
} from "./scan-persistence.js";

export type ScanExecutionResult = ScanResult & {
  http: HttpProbeResult;
  screenshotStored: boolean;
  scannerV2: ScannerV2PersistentSummary | null;
};

export type ScanProcessorDependencies = {
  probeHttpTarget?: typeof defaultProbeHttpTarget;
  runBrowserScan?: typeof defaultRunBrowserScan;
  persistPrimaryScreenshot?: typeof defaultPersistPrimaryScreenshot;
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

export async function processScanJobAttempt(
  jobData: ScanJob | unknown,
  dependencies: ScanProcessorDependencies = {},
): Promise<ScanExecutionResult> {
  const payload = ScanJobSchema.parse(jobData);
  const context = await validateScanContext(payload);
  const probeHttpTarget =
    dependencies.probeHttpTarget ?? defaultProbeHttpTarget;
  const runBrowserScan = dependencies.runBrowserScan ?? defaultRunBrowserScan;
  const persistPrimaryScreenshot =
    dependencies.persistPrimaryScreenshot ?? defaultPersistPrimaryScreenshot;

  await markScanRunning(context);

  const httpProbe = await probeHttpTarget(context.targetUrl);
  const httpFindings = generateHttpProbeFindings(httpProbe, context.targetUrl);
  let browserScan: BrowserScanResult | null = null;

  if (httpProbe.ok && isHtmlDocument(httpProbe)) {
    const publicAudit = context.scanMode === "public_audit";
    browserScan = await runBrowserScan(context.targetUrl, {
      scanMode: context.scanMode,
      maxPages: publicAudit
        ? Math.min(payload.profile.maxPages, 15)
        : payload.profile.maxPages,
      navigationTimeoutMs: publicAudit
        ? Math.min(payload.profile.navigationTimeoutMs, 20_000)
        : payload.profile.navigationTimeoutMs,
      checkAccessibility: payload.profile.checkAccessibility,
      captureScreenshot: payload.profile.captureScreenshots,
    });
  }

  const generatedFindings = [
    ...new Map(
      [
        ...httpFindings,
        ...(browserScan
          ? [
              ...generateBrowserFindings(browserScan.observations),
              ...(browserScan.scannerV2
                ? generateScannerV2Findings(browserScan.scannerV2)
                : []),
            ]
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

  const scannerV2Summary = browserScan?.scannerV2
    ? summarizeScannerV2(browserScan.scannerV2)
    : null;

  await persistScanCompletion(
    context,
    result,
    httpProbe,
    generatedFindings,
    scannerV2Summary,
  );

  let screenshotStored = false;
  if (payload.profile.captureScreenshots && browserScan?.screenshot) {
    try {
      screenshotStored = await persistPrimaryScreenshot({
        organizationId: context.organizationId,
        siteId: context.siteId,
        scanId: context.scanId,
        screenshot: browserScan.screenshot,
      });
    } catch {
      screenshotStored = false;
    }
  }

  return {
    ...result,
    http: httpProbe,
    screenshotStored,
    scannerV2: scannerV2Summary,
  };
}

export async function processScanJob(
  jobData: ScanJob | unknown,
  dependencies: ScanProcessorDependencies = {},
): Promise<ScanExecutionResult> {
  const payload = ScanJobSchema.parse(jobData);

  try {
    return await processScanJobAttempt(payload, dependencies);
  } catch (error) {
    try {
      await persistScanFailureForJob(payload, error);
    } catch {
      // Keep the original worker error as the failure cause.
    }
    throw error;
  }
}
