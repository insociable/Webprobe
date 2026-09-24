import { ScanJobSchema, type ScanJob } from "@agency-saas/contracts";
import { scanAttempts, scans, sites } from "@agency-saas/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { UnrecoverableError } from "bullmq";
import { getDatabase } from "./database.js";
import { runDeepAuditCandidate } from "./scan-engine/deep-candidate.js";
import {
  DeepLeaseBusyError,
  DeepLeaseError,
  type DeepLease,
} from "./scan-engine/deep-lease.js";
import { resolveScanProfile } from "./scan-engine/profiles.js";
import { classifyScanError } from "./scan-retry.js";
import { ScanContextError } from "./scan-persistence.js";

/** Two server process settings are required; job data cannot enable Deep. */
export function internalDeepWorkerEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    (env.WEBPROBE_RUNTIME_ENV === "preproduction" ||
      env.WEBPROBE_RUNTIME_ENV === "production") &&
    env.WEBPROBE_INTERNAL_DEEP_WORKER === "enabled"
  );
}

function unrecoverableDeepError(code: string) {
  return Object.assign(new UnrecoverableError(code), { code });
}

export async function scanModeForWorkerJob(jobData: unknown) {
  const payload = ScanJobSchema.parse(jobData);
  const { db } = getDatabase();
  const [scan] = await db
    .select({ mode: scans.scanMode })
    .from(scans)
    .where(eq(scans.id, payload.scanId))
    .limit(1);
  // Even a forged tenant/site payload must route by the row's actual mode.
  // A missing row retains the legacy V2 failure handling.
  return { payload, mode: scan?.mode ?? null };
}

type DeepResult = { scanId: string; status: "completed" | "already-completed" };

async function prepareDeepScan(payload: ScanJob): Promise<DeepResult | null> {
  const { db } = getDatabase();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ scan: scans, site: sites })
      .from(scans)
      .innerJoin(
        sites,
        and(
          eq(sites.id, scans.siteId),
          eq(sites.organizationId, scans.organizationId),
        ),
      )
      .where(
        and(
          eq(scans.id, payload.scanId),
          eq(scans.organizationId, payload.organizationId),
          eq(scans.siteId, payload.siteId),
        ),
      )
      .for("update", { of: scans })
      .limit(1);
    if (!row || row.scan.scanMode !== "verified_deep_audit")
      throw new ScanContextError("Deep scan context invalid", "scan-not-found");
    if (row.scan.status === "completed")
      return { scanId: payload.scanId, status: "already-completed" };
    if (
      (row.scan.status !== "queued" && row.scan.status !== "running") ||
      row.scan.trigger !== "manual" ||
      row.scan.scheduleId ||
      row.scan.summary.internalDeepWorker !== true ||
      row.scan.requestedByUserId !== null ||
      row.site.status !== "active" ||
      !row.site.verifiedAt ||
      row.site.canonicalUrl !== payload.targetUrl
    ) {
      throw new ScanContextError(
        "Deep scan is not runnable",
        "scan-not-runnable",
      );
    }
    if (row.scan.status === "queued") {
      await tx
        .update(scans)
        .set({ status: "running", startedAt: sql`clock_timestamp()` })
        .where(and(eq(scans.id, payload.scanId), eq(scans.status, "queued")));
    }
    return null;
  });
}

/** Only the attempt that held this token may record failure or close the scan. */
async function recordDeepFailure(
  lease: DeepLease,
  code: string,
  terminal: boolean,
): Promise<void> {
  const { db } = getDatabase();
  await db.transaction(async (tx) => {
    const [scan] = await tx
      .select({ id: scans.id, status: scans.status, mode: scans.scanMode })
      .from(scans)
      .where(
        and(
          eq(scans.id, lease.scanId),
          eq(scans.organizationId, lease.organizationId),
          eq(scans.siteId, lease.siteId),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !scan ||
      scan.status !== "running" ||
      scan.mode !== "verified_deep_audit"
    )
      return;
    const [latest] = await tx
      .select({
        id: scanAttempts.id,
        token: scanAttempts.leaseToken,
        status: scanAttempts.status,
      })
      .from(scanAttempts)
      .where(eq(scanAttempts.scanId, lease.scanId))
      .orderBy(desc(scanAttempts.attemptNumber))
      .limit(1);
    if (
      latest?.id !== lease.attemptId ||
      latest.token !== lease.token ||
      latest.status !== "retrying"
    )
      return;
    await tx
      .update(scanAttempts)
      .set({
        status: terminal ? "failed" : "retrying",
        retryable: !terminal,
        errorCode: code,
      })
      .where(
        and(
          eq(scanAttempts.id, lease.attemptId),
          eq(scanAttempts.leaseToken, lease.token),
          eq(scanAttempts.status, "retrying"),
        ),
      );
    if (terminal) {
      await tx
        .update(scans)
        .set({
          status: "failed",
          completedAt: sql`clock_timestamp()`,
          summary: { deepError: { code } },
        })
        .where(and(eq(scans.id, lease.scanId), eq(scans.status, "running")));
    }
  });
}

function pauseForLease(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Deep execution aborted"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, 1_000);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Deep execution aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** A direct queue injection still needs an internal DB marker and the server gate. */
export async function runInternalDeepWorkerJob(input: {
  payload: ScanJob;
  attemptsMade: number;
  configuredAttempts: number;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  candidate?: typeof runDeepAuditCandidate;
}): Promise<DeepResult> {
  if (!internalDeepWorkerEnabled(input.env ?? process.env))
    throw unrecoverableDeepError("deep-engine-unavailable");
  const runCandidate = input.candidate ?? runDeepAuditCandidate;
  let lease: DeepLease | undefined;
  const busyUntil = Date.now() + 35_000;
  try {
    while (true) {
      if (input.signal.aborted) throw new Error("Deep execution aborted");
      const duplicate = await prepareDeepScan(input.payload);
      if (duplicate) return duplicate;
      try {
        await runCandidate({
          scanId: input.payload.scanId,
          organizationId: input.payload.organizationId,
          siteId: input.payload.siteId,
          targetUrl: input.payload.targetUrl,
          // This profile exists only in this server-side preproduction path.
          profile: {
            ...resolveScanProfile("verified_deep_audit"),
            allowedChecks: [
              "deep-http-observation",
              "deep-browser-observation",
              "deep-tls",
              "deep-security-headers",
              "deep-csp",
              "deep-cookies",
              "deep-resources",
              "deep-endpoints",
              "deep-forms",
              "deep-browser-meta",
            ],
          },
          signal: input.signal,
          onLeaseClaimed: (claimed) => {
            lease = claimed;
          },
        });
        return { scanId: input.payload.scanId, status: "completed" };
      } catch (error) {
        if (
          error instanceof DeepLeaseBusyError &&
          Date.now() < busyUntil &&
          !input.signal.aborted
        ) {
          await pauseForLease(input.signal);
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    const classified = classifyScanError(error);
    const retryable =
      error instanceof DeepLeaseError ||
      (input.signal.aborted ? true : classified.retryable);
    const terminal =
      !retryable || input.attemptsMade + 1 >= input.configuredAttempts;
    if (lease) await recordDeepFailure(lease, classified.code, terminal);
    if (!retryable) throw unrecoverableDeepError(classified.code);
    throw error;
  }
}
