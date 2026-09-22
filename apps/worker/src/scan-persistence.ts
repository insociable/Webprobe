import { findings, scans, sites } from "@agency-saas/db";
import type { ScanJob, ScanResult, Severity } from "@agency-saas/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { getDatabase } from "./database.js";
import type { GeneratedFinding } from "./findings.js";
import type { HttpProbeResult } from "./http-probe.js";

export class ScanContextError extends Error {
  constructor(
    message: string,
    readonly code:
      | "scan-not-found"
      | "scan-not-runnable"
      | "site-not-active"
      | "target-mismatch",
  ) {
    super(message);
    this.name = "ScanContextError";
  }
}

export type ValidatedScanContext = {
  scanId: string;
  organizationId: string;
  siteId: string;
  targetUrl: string;
  startedAt: Date;
};

const runnableStatuses = ["queued", "running", "failed"] as const;
export async function validateScanContext(
  payload: ScanJob,
): Promise<ValidatedScanContext> {
  const { db } = getDatabase();

  const rows = await db
    .select({
      scanId: scans.id,
      scanStatus: scans.status,
      startedAt: scans.startedAt,
      organizationId: scans.organizationId,
      siteId: scans.siteId,
      siteStatus: sites.status,
      canonicalUrl: sites.canonicalUrl,
    })
    .from(scans)
    .innerJoin(
      sites,
      and(
        eq(scans.siteId, sites.id),
        eq(scans.organizationId, sites.organizationId),
      ),
    )
    .where(
      and(
        eq(scans.id, payload.scanId),
        eq(scans.organizationId, payload.organizationId),
        eq(scans.siteId, payload.siteId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new ScanContextError("Scan context does not exist", "scan-not-found");
  }

  if (
    !runnableStatuses.includes(
      row.scanStatus as (typeof runnableStatuses)[number],
    )
  ) {
    throw new ScanContextError("Scan is not runnable", "scan-not-runnable");
  }

  if (row.siteStatus !== "active") {
    throw new ScanContextError("Site is not active", "site-not-active");
  }

  if (row.canonicalUrl !== payload.targetUrl) {
    throw new ScanContextError(
      "Queued target does not match site",
      "target-mismatch",
    );
  }

  return {
    scanId: row.scanId,
    organizationId: row.organizationId,
    siteId: row.siteId,
    targetUrl: row.canonicalUrl,
    startedAt: row.startedAt ?? new Date(),
  };
}
export async function markScanRunning(
  context: ValidatedScanContext,
): Promise<void> {
  const { db } = getDatabase();

  const updated = await db
    .update(scans)
    .set({
      status: "running",
      startedAt: context.startedAt,
      completedAt: null,
    })
    .where(
      and(
        eq(scans.id, context.scanId),
        eq(scans.organizationId, context.organizationId),
        eq(scans.siteId, context.siteId),
        inArray(scans.status, ["queued", "running", "failed"]),
      ),
    )
    .returning({ id: scans.id });

  if (updated.length !== 1) {
    throw new ScanContextError("Scan is not runnable", "scan-not-runnable");
  }
}

function severityCounts(generatedFindings: GeneratedFinding[]) {
  const counts: Record<Severity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const item of generatedFindings) {
    counts[item.severity] += 1;
  }

  return counts;
}

export async function persistScanCompletion(
  context: ValidatedScanContext,
  result: ScanResult,
  probe: HttpProbeResult,
  generatedFindings: GeneratedFinding[],
): Promise<void> {
  const { db } = getDatabase();

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(scans)
      .set({
        status: "completed",
        pageCount: result.pagesVisited,
        completedAt: new Date(result.completedAt),
        summary: {
          targetUrl: context.targetUrl,
          http: probe,
          findingCount: generatedFindings.length,
          findingsBySeverity: severityCounts(generatedFindings),
        },
      })
      .where(
        and(
          eq(scans.id, context.scanId),
          eq(scans.organizationId, context.organizationId),
          eq(scans.siteId, context.siteId),
          eq(scans.status, "running"),
        ),
      )
      .returning({ id: scans.id });

    if (updated.length !== 1) {
      throw new ScanContextError(
        "Scan is no longer running",
        "scan-not-runnable",
      );
    }

    await tx
      .delete(findings)
      .where(
        and(
          eq(findings.scanId, context.scanId),
          eq(findings.organizationId, context.organizationId),
        ),
      );

    if (generatedFindings.length > 0) {
      await tx.insert(findings).values(
        generatedFindings.map((item) => ({
          organizationId: context.organizationId,
          scanId: context.scanId,
          category: item.category,
          severity: item.severity,
          code: item.code,
          title: item.title,
          pageUrl: item.pageUrl,
          fingerprint: item.fingerprint,
          evidence: item.evidence,
        })),
      );
    }
  });
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 120);
  }

  return "worker-error";
}

export async function persistScanFailure(
  context: ValidatedScanContext,
  error: unknown,
): Promise<void> {
  const { db } = getDatabase();

  await db
    .update(scans)
    .set({
      status: "failed",
      pageCount: 0,
      completedAt: new Date(),
      summary: {
        targetUrl: context.targetUrl,
        error: {
          code: safeErrorCode(error),
        },
      },
    })
    .where(
      and(
        eq(scans.id, context.scanId),
        eq(scans.organizationId, context.organizationId),
        eq(scans.siteId, context.siteId),
        inArray(scans.status, ["running", "queued", "failed"]),
      ),
    );
}
