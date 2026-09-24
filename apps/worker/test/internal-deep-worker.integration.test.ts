import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  deepAuditAuthorizations,
  organizations,
  scanAttempts,
  scanCheckRuns,
  scans,
  sites,
} from "@agency-saas/db";
import { asc, eq, sql } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import type { ScanJob } from "@agency-saas/contracts";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { closeDatabase, getDatabase } from "../src/database.js";
import {
  runInternalDeepWorkerJob,
  scanModeForWorkerJob,
} from "../src/internal-deep-worker.js";
import { runDeepAuditCandidate } from "../src/scan-engine/deep-candidate.js";
import {
  claimDeepLease,
  releaseDeepLease,
} from "../src/scan-engine/deep-lease.js";
import { revalidateDeepAuditAuthorization } from "../src/scan-engine/deep-proof.js";
import { persistDeepCheckRuns } from "../src/scan-engine/check-persistence.js";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { parseRedisConnectionUrl } from "../src/redis-connection.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const enabled = {
  WEBPROBE_RUNTIME_ENV: "preproduction",
  WEBPROBE_INTERNAL_DEEP_WORKER: "enabled",
};
const targetUrl = "https://deep.example.test/";
const proof = "agency-monitor-deep=worker-fixture";

async function fixture() {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const scanId = randomUUID();
  const generationId = randomUUID();
  const now = new Date();
  await db
    .insert(organizations)
    .values({ id: organizationId, name: "Deep worker" });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Deep worker site",
    canonicalUrl: targetUrl,
    status: "active",
    verifiedAt: now,
  });
  await db.insert(scans).values({
    id: scanId,
    organizationId,
    siteId,
    trigger: "manual",
    scanMode: "verified_deep_audit",
    status: "queued",
    summary: { internalDeepWorker: true },
  });
  await db.insert(deepAuditAuthorizations).values({
    siteId,
    proofType: "dns_txt",
    proofRecordName: "_agency-monitor.deep.example.test",
    proofTokenHash: createHash("sha256").update(proof).digest("hex"),
    generationId,
    proofVerifiedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  return {
    organizationId,
    siteId,
    scanId,
    generationId,
    payload: {
      scanId,
      organizationId,
      siteId,
      targetUrl,
      profile: {
        maxPages: 20,
        navigationTimeoutMs: 20_000,
        checkAccessibility: true,
        captureScreenshots: true,
      },
    },
    async cleanup() {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    },
  };
}

function fakeBrowser(): Browser {
  let onPage: ((page: Page) => void) | undefined;
  const page = {
    on: () => page,
    goto: async () => ({ status: () => 200 }) as unknown as Response,
    url: () => targetUrl,
    close: async () => undefined,
  } as unknown as Page;
  const context = {
    setDefaultNavigationTimeout: () => undefined,
    setDefaultTimeout: () => undefined,
    on: (event: string, handler: (page: Page) => void) => {
      if (event === "page") onPage = handler;
      return context;
    },
    route: async () => undefined,
    routeWebSocket: async () => undefined,
    newPage: async () => {
      onPage?.(page);
      return page;
    },
    close: async () => undefined,
  } as unknown as BrowserContext;
  return {
    newContext: async () => context,
    close: async () => undefined,
  } as unknown as Browser;
}

afterAll(async () => {
  await closeDatabase();
});

describeDatabase("internal Deep worker lifecycle", () => {
  it("rejects a queued Deep job without the gate before creating an attempt", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    try {
      expect(
        (
          await scanModeForWorkerJob({
            ...f.payload,
            organizationId: randomUUID(),
          })
        ).mode,
      ).toBe("verified_deep_audit");
      await expect(
        runInternalDeepWorkerJob({
          payload: f.payload,
          attemptsMade: 0,
          configuredAttempts: 3,
          signal: new AbortController().signal,
          env: {},
        }),
      ).rejects.toMatchObject({
        message: "deep-engine-unavailable",
        code: "deep-engine-unavailable",
      });
      expect(
        await db
          .select()
          .from(scanAttempts)
          .where(eq(scanAttempts.scanId, f.scanId)),
      ).toHaveLength(0);
      const [scan] = await db
        .select()
        .from(scans)
        .where(eq(scans.id, f.scanId));
      expect(scan?.status).toBe("queued");
    } finally {
      await f.cleanup();
    }
  });

  it("rejects a NULL grant generation at the PostgreSQL boundary", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    try {
      await expect(
        db
          .update(deepAuditAuthorizations)
          .set({ generationId: sql`NULL` })
          .where(eq(deepAuditAuthorizations.siteId, f.siteId)),
      ).rejects.toThrow();

      const [grant] = await db
        .select({ generationId: deepAuditAuthorizations.generationId })
        .from(deepAuditAuthorizations)
        .where(eq(deepAuditAuthorizations.siteId, f.siteId));
      expect(grant?.generationId).toBe(f.generationId);

      expect(
        await db
          .select()
          .from(scanAttempts)
          .where(eq(scanAttempts.scanId, f.scanId)),
      ).toHaveLength(0);
      const [scan] = await db
        .select()
        .from(scans)
        .where(eq(scans.id, f.scanId));
      expect(scan?.status).toBe("queued");
    } finally {
      await f.cleanup();
    }
  });

  it("runs the guarded candidate, finalizes atomically, and ignores redelivery", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    const requests = vi.fn(
      async (
        _target: unknown,
        _timeout: number,
        account?: (bytes: number) => void,
      ) => {
        account?.(256);
        return { statusCode: 200, durationMs: 1, tls: null, headers: {} };
      },
    );
    const candidate: typeof runDeepAuditCandidate = (input) =>
      runDeepAuditCandidate({
        ...input,
        resolveTxt: async () => [[proof]],
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
        requester: requests,
        launchBrowser: async () => fakeBrowser(),
      });
    const run = () =>
      runInternalDeepWorkerJob({
        payload: f.payload,
        attemptsMade: 0,
        configuredAttempts: 3,
        signal: new AbortController().signal,
        env: enabled,
        candidate,
      });
    try {
      expect((await run()).status).toBe("completed");
      expect((await run()).status).toBe("already-completed");
      expect(requests).toHaveBeenCalledOnce();
      const [scan] = await db
        .select()
        .from(scans)
        .where(eq(scans.id, f.scanId));
      expect(scan?.status).toBe("completed");
      expect(scan?.completedAt).toBeInstanceOf(Date);
      expect(
        await db
          .select()
          .from(scanCheckRuns)
          .where(eq(scanCheckRuns.scanId, f.scanId)),
      ).toHaveLength(2);
      const attempts = await db
        .select()
        .from(scanAttempts)
        .where(eq(scanAttempts.scanId, f.scanId));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.status).toBe("completed");
    } finally {
      await f.cleanup();
    }
  });

  it("serializes two worker deliveries without duplicating network or attempts", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dns = vi.fn(async () => {
      entered();
      await blocked;
      return [[proof]];
    });
    const requester = vi.fn(
      async (
        _target: unknown,
        _timeout: number,
        account?: (bytes: number) => void,
      ) => {
        account?.(256);
        return { statusCode: 200, durationMs: 1, tls: null, headers: {} };
      },
    );
    const candidate: typeof runDeepAuditCandidate = (input) =>
      runDeepAuditCandidate({
        ...input,
        resolveTxt: dns,
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
        requester,
        launchBrowser: async () => fakeBrowser(),
      });
    const run = () =>
      runInternalDeepWorkerJob({
        payload: f.payload,
        attemptsMade: 0,
        configuredAttempts: 3,
        signal: new AbortController().signal,
        env: enabled,
        candidate,
      });
    try {
      const first = run();
      await started;
      const second = run();
      release();
      const outcomes = await Promise.all([first, second]);
      expect(outcomes.map((item) => item.status).sort()).toEqual([
        "already-completed",
        "completed",
      ]);
      expect(dns).toHaveBeenCalledOnce();
      expect(requester).toHaveBeenCalledOnce();
      const attempts = await db
        .select()
        .from(scanAttempts)
        .where(eq(scanAttempts.scanId, f.scanId));
      expect(attempts).toHaveLength(1);
    } finally {
      release?.();
      await f.cleanup();
    }
  });

  it("cannot start after cancellation or without the internal DB marker", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    const candidate = vi.fn<typeof runDeepAuditCandidate>();
    const run = () =>
      runInternalDeepWorkerJob({
        payload: f.payload,
        attemptsMade: 0,
        configuredAttempts: 3,
        signal: new AbortController().signal,
        env: enabled,
        candidate,
      });
    try {
      await db.update(scans).set({ summary: {} }).where(eq(scans.id, f.scanId));
      await expect(run()).rejects.toThrow("scan-not-runnable");
      await db
        .update(scans)
        .set({
          summary: { internalDeepWorker: true },
          status: "cancelled",
        })
        .where(eq(scans.id, f.scanId));
      await expect(run()).rejects.toThrow("scan-not-runnable");
      expect(candidate).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });

  it("cannot persist or enter HTTP when the scan is cancelled during TXT proof", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requester = vi.fn(async () => {
      throw new Error("HTTP must not start");
    });
    const candidate: typeof runDeepAuditCandidate = (input) =>
      runDeepAuditCandidate({
        ...input,
        resolveTxt: async () => {
          entered();
          await blocked;
          return [[proof]];
        },
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
        requester,
      });
    try {
      const running = runInternalDeepWorkerJob({
        payload: f.payload,
        attemptsMade: 0,
        configuredAttempts: 3,
        signal: new AbortController().signal,
        env: enabled,
        candidate,
      });
      const failure = running.catch((error: unknown) => error);
      await started;
      await db
        .update(scans)
        .set({ status: "cancelled" })
        .where(eq(scans.id, f.scanId));
      release();
      expect(await failure).toBeInstanceOf(Error);
      expect(requester).not.toHaveBeenCalled();
      expect(
        await db
          .select()
          .from(scanCheckRuns)
          .where(eq(scanCheckRuns.scanId, f.scanId)),
      ).toHaveLength(0);
      const [scan] = await db
        .select()
        .from(scans)
        .where(eq(scans.id, f.scanId));
      expect(scan?.status).toBe("cancelled");
    } finally {
      release?.();
      await f.cleanup();
    }
  });

  it("does not let an old worker close a successor's completed scan", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const oldCandidate: typeof runDeepAuditCandidate = async (input) => {
      const lease = await claimDeepLease(input);
      input.onLeaseClaimed?.(lease);
      await releaseDeepLease(lease);
      entered();
      await blocked;
      throw Object.assign(new Error("old worker failed"), {
        code: "ETIMEDOUT",
      });
    };
    const newCandidate: typeof runDeepAuditCandidate = (input) =>
      runDeepAuditCandidate({
        ...input,
        resolveTxt: async () => [[proof]],
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
        requester: async (_target, _timeout, account) => {
          account?.(256);
          return { statusCode: 200, durationMs: 1, tls: null, headers: {} };
        },
        launchBrowser: async () => fakeBrowser(),
      });
    const base = {
      payload: f.payload,
      attemptsMade: 0,
      configuredAttempts: 1,
      signal: new AbortController().signal,
      env: enabled,
    };
    try {
      const old = runInternalDeepWorkerJob({
        ...base,
        candidate: oldCandidate,
      });
      const oldFailure = old.catch((error: unknown) => error);
      await started;
      expect(
        (await runInternalDeepWorkerJob({ ...base, candidate: newCandidate }))
          .status,
      ).toBe("completed");
      release();
      expect(await oldFailure).toBeInstanceOf(Error);
      const [scan] = await db
        .select()
        .from(scans)
        .where(eq(scans.id, f.scanId));
      expect(scan?.status).toBe("completed");
      const attempts = await db
        .select()
        .from(scanAttempts)
        .where(eq(scanAttempts.scanId, f.scanId));
      expect(attempts).toHaveLength(2);
      expect(attempts[0]?.status).toBe("retrying");
      expect(attempts[1]?.status).toBe("completed");
    } finally {
      release?.();
      await f.cleanup();
    }
  });

  it("recovers a crashed worker after natural lease expiry without reusing its token", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    try {
      await db
        .update(scans)
        .set({ status: "running" })
        .where(eq(scans.id, f.scanId));
      // A claims the lease, then its process disappears without release or renew.
      const first = await claimDeepLease(f);
      await expect(claimDeepLease(f)).rejects.toThrow("active");
      let second: Awaited<ReturnType<typeof claimDeepLease>> | undefined;
      await vi.waitFor(
        async () => {
          second = await claimDeepLease(f);
        },
        { timeout: 36_000, interval: 500 },
      );
      expect(second?.attemptNumber).toBe(first.attemptNumber + 1);
      expect(second?.token).not.toBe(first.token);
      if (second) await releaseDeepLease(second);
      const attempts = await db
        .select()
        .from(scanAttempts)
        .where(eq(scanAttempts.scanId, f.scanId));
      expect(attempts).toHaveLength(2);
      expect(attempts[0]?.status).toBe("retrying");
    } finally {
      await f.cleanup();
    }
  }, 40_000);

  it("rejects a grant revoked immediately before the final transaction", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    await db
      .update(scans)
      .set({ status: "running" })
      .where(eq(scans.id, f.scanId));
    const lease = await claimDeepLease(f);
    try {
      const authorization = await revalidateDeepAuditAuthorization({
        siteId: f.siteId,
        organizationId: f.organizationId,
        resolveTxt: async () => [[proof]],
      });
      if (!authorization.allowed || !authorization.grantIdentity)
        throw new Error("Fixture grant is unavailable");
      await db
        .update(deepAuditAuthorizations)
        .set({ revokedAt: new Date() })
        .where(eq(deepAuditAuthorizations.siteId, f.siteId));
      const now = new Date();
      await expect(
        persistDeepCheckRuns({
          scanId: f.scanId,
          organizationId: f.organizationId,
          siteId: f.siteId,
          targetUrl,
          lease,
          grantIdentity: authorization.grantIdentity,
          ledger: new BudgetLedger(
            resolveScanProfile("verified_deep_audit").budget,
            Date.now(),
          ),
          runs: [
            {
              checkId: "deep-http-observation",
              checkVersion: "1.0.0",
              status: "skipped",
              startedAt: now,
              completedAt: now,
              durationMs: 0,
              budgetUsed: {},
              skipReason: "observation-unavailable",
              evidence: [],
            },
          ],
        }),
      ).rejects.toThrow("grant changed");
      expect(
        await db
          .select()
          .from(scanCheckRuns)
          .where(eq(scanCheckRuns.scanId, f.scanId)),
      ).toHaveLength(0);
      const [scan] = await db
        .select()
        .from(scans)
        .where(eq(scans.id, f.scanId));
      expect(scan?.status).toBe("running");
    } finally {
      await releaseDeepLease(lease);
      await f.cleanup();
    }
  });
});

const describeRedis =
  process.env.RUN_DB_INTEGRATION === "1" &&
  process.env.RUN_REDIS_INTEGRATION === "1"
    ? describe
    : describe.skip;

describeRedis("internal Deep BullMQ retry", () => {
  it("uses a new fenced token after a transient worker attempt", async () => {
    const f = await fixture();
    const connection = {
      ...parseRedisConnectionUrl(process.env.REDIS_URL),
      maxRetriesPerRequest: null,
    };
    const name = `internal-deep-${randomUUID()}`;
    const queue = new Queue<ScanJob>(name, { connection });
    let invocation = 0;
    const candidate: typeof runDeepAuditCandidate = async (input) => {
      invocation += 1;
      if (invocation === 1) {
        const lease = await claimDeepLease(input);
        input.onLeaseClaimed?.(lease);
        await releaseDeepLease(lease);
        const error = Object.assign(new Error("transient"), {
          code: "ETIMEDOUT",
        });
        throw error;
      }
      await runDeepAuditCandidate({
        ...input,
        resolveTxt: async () => [[proof]],
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
        requester: async (_target, _timeout, account) => {
          account?.(256);
          return { statusCode: 200, durationMs: 1, tls: null, headers: {} };
        },
        launchBrowser: async () => fakeBrowser(),
      });
    };
    const worker = new Worker<ScanJob>(
      name,
      async (job) => {
        const route = await scanModeForWorkerJob(job.data);
        if (route.mode !== "verified_deep_audit") throw new Error("wrong mode");
        return runInternalDeepWorkerJob({
          payload: route.payload,
          attemptsMade: job.attemptsMade,
          configuredAttempts: job.opts.attempts ?? 1,
          signal: new AbortController().signal,
          env: enabled,
          candidate,
        });
      },
      { connection, concurrency: 2 },
    );
    try {
      const job = await queue.add("scan", f.payload, {
        attempts: 3,
        backoff: { type: "fixed", delay: 100 },
      });
      await vi.waitFor(
        async () => {
          expect(await job.getState()).toBe("completed");
        },
        { timeout: 15_000, interval: 100 },
      );
      const { db } = getDatabase();
      const attempts = await db
        .select()
        .from(scanAttempts)
        .where(eq(scanAttempts.scanId, f.scanId))
        .orderBy(asc(scanAttempts.attemptNumber));
      expect(attempts).toHaveLength(2);
      expect(attempts[0]?.leaseToken).not.toBe(attempts[1]?.leaseToken);
      expect(attempts[0]?.status).toBe("retrying");
      expect(attempts[1]?.status).toBe("completed");
      const [scan] = await db
        .select()
        .from(scans)
        .where(eq(scans.id, f.scanId));
      expect(scan?.status).toBe("completed");
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await f.cleanup();
    }
  }, 20_000);
});
