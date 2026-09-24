import { scanAttempts, scans } from "@agency-saas/db";
import { and, desc, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { getDatabase } from "./database.js";
import { ScanContextError } from "./scan-persistence.js";

export const MAX_SCAN_EXECUTION_ATTEMPTS = 3;
export const MAX_STALE_RECOVERY_ATTEMPTS = 5;

export type ScanErrorClassification = {
  retryable: boolean;
  code: string;
};

export type ActiveScanAttempt = {
  id: string;
  scanId: string;
  attemptNumber: number;
};

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 120);
  }
  return undefined;
}

export function classifyScanError(error: unknown): ScanErrorClassification {
  if (error instanceof ScanContextError) {
    return { retryable: false, code: error.code };
  }

  if (error instanceof ZodError) {
    return { retryable: false, code: "invalid-scan-job" };
  }

  const code = errorCode(error);
  if (code) {
    const retryableCodes = new Set([
      "EAI_AGAIN",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "EPIPE",
      "55P03",
      "57P01",
      "57P02",
      "57P03",
    ]);
    if (
      retryableCodes.has(code) ||
      code.startsWith("08") ||
      code.startsWith("40") ||
      code.startsWith("53")
    ) {
      return { retryable: true, code };
    }
    return { retryable: false, code };
  }

  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "TargetClosedError") {
      return { retryable: true, code: error.name };
    }

    if (
      /safe browser proxy did not bind|initial browser navigation failed|browser has been closed|target page, context or browser has been closed/i.test(
        error.message,
      )
    ) {
      return { retryable: true, code: "browser-runtime-transient" };
    }

    return {
      retryable: false,
      code: (error.name || "scan-execution-failed").slice(0, 120),
    };
  }

  return { retryable: false, code: "scan-execution-failed" };
}

export async function beginScanAttempt(
  scanId: string,
  now = new Date(),
): Promise<ActiveScanAttempt> {
  const { db } = getDatabase();

  return db.transaction(async (tx) => {
    const [scan] = await tx
      .select({ id: scans.id, mode: scans.scanMode })
      .from(scans)
      .where(eq(scans.id, scanId))
      .limit(1)
      .for("update", { of: scans });

    if (!scan) {
      throw new Error("Cannot start attempt for missing scan");
    }
    if (scan.mode === "verified_deep_audit") {
      throw new ScanContextError(
        "Deep attempts require the fenced lease lifecycle",
        "deep-engine-unavailable",
      );
    }

    const [latest] = await tx
      .select({
        id: scanAttempts.id,
        attemptNumber: scanAttempts.attemptNumber,
        status: scanAttempts.status,
      })
      .from(scanAttempts)
      .where(eq(scanAttempts.scanId, scanId))
      .orderBy(desc(scanAttempts.attemptNumber))
      .limit(1);

    if (latest?.status === "running") {
      await tx
        .update(scanAttempts)
        .set({
          status: "retrying",
          retryable: true,
          errorCode: "worker-interrupted",
          completedAt: now,
        })
        .where(
          and(
            eq(scanAttempts.id, latest.id),
            eq(scanAttempts.status, "running"),
          ),
        );
    }

    const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
    const [attempt] = await tx
      .insert(scanAttempts)
      .values({
        scanId,
        attemptNumber,
        status: "running",
        retryable: false,
        startedAt: now,
      })
      .returning({ id: scanAttempts.id });

    if (!attempt) {
      throw new Error("Scan attempt creation failed");
    }

    return { id: attempt.id, scanId, attemptNumber };
  });
}

export async function completeScanAttempt(
  attempt: ActiveScanAttempt,
  now = new Date(),
): Promise<void> {
  const { db } = getDatabase();
  await db
    .update(scanAttempts)
    .set({
      status: "completed",
      retryable: false,
      errorCode: null,
      completedAt: now,
    })
    .where(
      and(eq(scanAttempts.id, attempt.id), eq(scanAttempts.status, "running")),
    );
}

export async function failScanAttempt(
  attempt: ActiveScanAttempt,
  classification: ScanErrorClassification,
  terminal: boolean,
  now = new Date(),
): Promise<void> {
  const { db } = getDatabase();
  await db
    .update(scanAttempts)
    .set({
      status: terminal ? "failed" : "retrying",
      retryable: classification.retryable,
      errorCode: classification.code,
      completedAt: now,
    })
    .where(
      and(eq(scanAttempts.id, attempt.id), eq(scanAttempts.status, "running")),
    );
}

export async function getScanAttemptCount(scanId: string): Promise<number> {
  const { db } = getDatabase();
  const [latest] = await db
    .select({ attemptNumber: scanAttempts.attemptNumber })
    .from(scanAttempts)
    .where(eq(scanAttempts.scanId, scanId))
    .orderBy(desc(scanAttempts.attemptNumber))
    .limit(1);
  return latest?.attemptNumber ?? 0;
}
