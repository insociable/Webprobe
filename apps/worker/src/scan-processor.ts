import {
  ScanJobSchema,
  ScanResultSchema,
  type ScanJob,
  type ScanResult,
} from "@agency-saas/contracts";
import { generateHttpProbeFindings } from "./findings.js";
import { probeHttpTarget, type HttpProbeResult } from "./http-probe.js";
import {
  markScanRunning,
  persistScanCompletion,
  persistScanFailure,
  validateScanContext,
} from "./scan-persistence.js";

export type ScanExecutionResult = ScanResult & {
  http: HttpProbeResult;
};

export async function processScanJob(
  jobData: ScanJob | unknown,
): Promise<ScanExecutionResult> {
  const payload = ScanJobSchema.parse(jobData);
  const context = await validateScanContext(payload);

  await markScanRunning(context);

  try {
    const httpProbe = await probeHttpTarget(context.targetUrl);
    const generatedFindings = generateHttpProbeFindings(
      httpProbe,
      context.targetUrl,
    );
    const completedAt = new Date();

    const result = ScanResultSchema.parse({
      scanId: context.scanId,
      startedAt: context.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      status: "completed",
      pagesVisited: httpProbe.ok ? 1 : 0,
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
