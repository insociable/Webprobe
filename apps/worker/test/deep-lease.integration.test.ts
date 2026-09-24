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
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../src/database.js";
import { beginScanAttempt } from "../src/scan-retry.js";
import {
  assertDeepLease,
  claimDeepLease,
  releaseDeepLease,
  renewDeepLease,
} from "../src/scan-engine/deep-lease.js";
import { runDeepAuditCandidate } from "../src/scan-engine/deep-candidate.js";
import { revalidateDeepAuditAuthorization } from "../src/scan-engine/deep-proof.js";
import { probeGuardedHttpTarget } from "../src/scan-engine/guarded-http-transport.js";
import { BudgetLedger } from "../src/scan-engine/budget-ledger.js";
import { resolveScanProfile } from "../src/scan-engine/profiles.js";
import { ScopeGuard } from "../src/scan-engine/scope-guard.js";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const token = "agency-monitor-deep=lease-fixture";
const hash = createHash("sha256").update(token).digest("hex");

async function fixture() {
  const { db } = getDatabase();
  const organizationId = randomUUID();
  const siteId = randomUUID();
  const scanId = randomUUID();
  const generationId = randomUUID();
  const verifiedAt = new Date(Date.now() - 60_000);
  await db
    .insert(organizations)
    .values({ id: organizationId, name: "Deep lease fixture" });
  await db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Deep lease site",
    canonicalUrl: "https://deep.example.test/",
    status: "active",
    verifiedAt,
  });
  await db.insert(scans).values({
    id: scanId,
    organizationId,
    siteId,
    trigger: "manual",
    status: "running",
    scanMode: "verified_deep_audit",
  });
  await db.insert(deepAuditAuthorizations).values({
    siteId,
    proofType: "dns_txt",
    proofRecordName: "_agency-monitor.deep.example.test",
    proofTokenHash: hash,
    generationId,
    proofVerifiedAt: verifiedAt,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return {
    scanId,
    siteId,
    organizationId,
    generationId,
    async cleanup() {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    },
  };
}

afterAll(async () => {
  await closeDatabase();
});

describeDatabase("Deep execution lease on PostgreSQL", () => {
  it("does not claim or resolve DNS when cancelled before execution", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    const controller = new AbortController();
    controller.abort();
    const dns = vi.fn(async () => [[token]]);
    try {
      await expect(
        runDeepAuditCandidate({
          ...f,
          targetUrl: "https://deep.example.test/",
          signal: controller.signal,
          resolveTxt: dns,
        }),
      ).rejects.toThrow("aborted");
      expect(dns).not.toHaveBeenCalled();
      expect(
        await db
          .select()
          .from(scanAttempts)
          .where(eq(scanAttempts.scanId, f.scanId)),
      ).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });
  it("serializes two workers, forbids a live steal and fences an expired attempt", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    try {
      const claims = await Promise.allSettled([
        claimDeepLease(f),
        claimDeepLease(f),
      ]);
      expect(claims.filter((item) => item.status === "fulfilled")).toHaveLength(
        1,
      );
      const winner = claims.find((item) => item.status === "fulfilled");
      if (!winner || winner.status !== "fulfilled")
        throw new Error("No winner");
      const first = winner.value;
      await expect(beginScanAttempt(f.scanId)).rejects.toMatchObject({
        code: "deep-engine-unavailable",
      });
      const [stillRunning] = await db
        .select()
        .from(scanAttempts)
        .where(eq(scanAttempts.id, first.attemptId));
      expect(stillRunning?.status).toBe("running");
      await renewDeepLease(first);
      await expect(claimDeepLease(f)).rejects.toThrow("active");
      await db
        .update(scanAttempts)
        .set({ leaseUntil: new Date(Date.now() - 1) })
        .where(eq(scanAttempts.id, first.attemptId));
      const second = await claimDeepLease(f);
      expect(second.attemptNumber).toBe(2);
      await expect(assertDeepLease(first)).rejects.toThrow();
      await assertDeepLease(second);
      await releaseDeepLease(second);
      const attempts = await db
        .select()
        .from(scanAttempts)
        .where(eq(scanAttempts.scanId, f.scanId));
      expect(attempts).toHaveLength(2);
      expect(attempts.every((item) => item.status === "retrying")).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("allows only one candidate to do DNS and HTTP and persists one result set", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    let enterDns!: () => void;
    let finishDns!: () => void;
    const started = new Promise<void>((resolve) => {
      enterDns = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      finishDns = resolve;
    });
    const dns = vi.fn(async () => {
      enterDns();
      await blocked;
      return [[token]];
    });
    const requests = vi.fn(
      async (
        _target: unknown,
        _timeout: number,
        account?: (n: number) => void,
      ) => {
        account?.(256);
        return { statusCode: 200, durationMs: 1, tls: null, headers: {} };
      },
    );
    const input = {
      ...f,
      targetUrl: "https://deep.example.test/",
      profile: {
        ...resolveScanProfile("verified_deep_audit"),
        allowedChecks: ["deep-http-observation"],
      },
      resolveTxt: dns,
      resolver: async () => [{ address: "93.184.216.34", family: 4 as const }],
      requester: requests,
    };
    try {
      const first = runDeepAuditCandidate(input);
      await started;
      await expect(runDeepAuditCandidate(input)).rejects.toThrow("active");
      finishDns();
      await first;
      expect(dns).toHaveBeenCalledOnce();
      expect(requests).toHaveBeenCalledOnce();
      const runs = await db
        .select()
        .from(scanCheckRuns)
        .where(eq(scanCheckRuns.scanId, f.scanId));
      expect(runs).toHaveLength(2);
      await expect(runDeepAuditCandidate(input)).rejects.toThrow("not running");
      expect(requests).toHaveBeenCalledOnce();
    } finally {
      finishDns?.();
      await f.cleanup();
    }
  });

  it("recovery after an expired lease does not let the old worker start HTTP", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const requester = vi.fn(
      async (
        _target: unknown,
        _timeout: number,
        account?: (n: number) => void,
      ) => {
        account?.(256);
        return { statusCode: 200, durationMs: 1, tls: null, headers: {} };
      },
    );
    const common = {
      ...f,
      targetUrl: "https://deep.example.test/",
      profile: {
        ...resolveScanProfile("verified_deep_audit"),
        allowedChecks: ["deep-http-observation"],
      },
      resolver: async () => [{ address: "93.184.216.34", family: 4 as const }],
      requester,
    };
    try {
      const oldWorker = runDeepAuditCandidate({
        ...common,
        resolveTxt: async () => {
          entered();
          await blocked;
          return [[token]];
        },
      });
      const oldFailure = oldWorker.catch((error: unknown) => error);
      await started;
      const [attempt] = await db
        .select()
        .from(scanAttempts)
        .where(eq(scanAttempts.scanId, f.scanId));
      await db
        .update(scanAttempts)
        .set({ leaseUntil: new Date(Date.now() - 1) })
        .where(eq(scanAttempts.id, attempt!.id));
      await runDeepAuditCandidate({
        ...common,
        resolveTxt: async () => [[token]],
      });
      finish();
      expect(await oldFailure).toBeInstanceOf(Error);
      expect(requester).toHaveBeenCalledOnce();
      expect(
        await db
          .select()
          .from(scanCheckRuns)
          .where(eq(scanCheckRuns.scanId, f.scanId)),
      ).toHaveLength(2);
    } finally {
      finish?.();
      await f.cleanup();
    }
  });

  it("denies grants expiring or changing during DNS and an inactive site", async () => {
    for (const change of [
      "expire",
      "revoke",
      "replace",
      "pause",
      "deactivate",
      "url",
    ] as const) {
      const f = await fixture();
      const { db } = getDatabase();
      const requests = vi.fn(async () => {
        throw new Error("No HTTP allowed");
      });
      try {
        const running = runDeepAuditCandidate({
          ...f,
          targetUrl: "https://deep.example.test/",
          profile: {
            ...resolveScanProfile("verified_deep_audit"),
            allowedChecks: ["deep-http-observation"],
          },
          resolveTxt: async () => {
            if (change === "expire")
              await db
                .update(deepAuditAuthorizations)
                .set({ expiresAt: new Date(Date.now() - 1) })
                .where(eq(deepAuditAuthorizations.siteId, f.siteId));
            if (change === "revoke")
              await db
                .update(deepAuditAuthorizations)
                .set({ revokedAt: new Date() })
                .where(eq(deepAuditAuthorizations.siteId, f.siteId));
            if (change === "replace")
              await db
                .update(deepAuditAuthorizations)
                .set({ generationId: randomUUID() })
                .where(eq(deepAuditAuthorizations.siteId, f.siteId));
            if (change === "pause")
              await db
                .update(sites)
                .set({ status: "paused" })
                .where(eq(sites.id, f.siteId));
            if (change === "deactivate")
              await db
                .update(sites)
                .set({ status: "pending_verification", verifiedAt: null })
                .where(eq(sites.id, f.siteId));
            if (change === "url")
              await db
                .update(sites)
                .set({ canonicalUrl: "https://deep.example.test/changed" })
                .where(eq(sites.id, f.siteId));
            return [[token]];
          },
          resolver: async () => [
            { address: "93.184.216.34", family: 4 as const },
          ],
          requester: requests,
        });
        await expect(running).rejects.toThrow();
        expect(requests).not.toHaveBeenCalled();
      } finally {
        await f.cleanup();
      }
    }
  });

  it("aborts an in-flight HTTP probe when the lease is lost", async () => {
    const f = await fixture();
    const { db } = getDatabase();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const requester = vi.fn(async () => {
      entered();
      return new Promise<never>(() => undefined);
    });
    try {
      const running = runDeepAuditCandidate({
        ...f,
        targetUrl: "https://deep.example.test/",
        profile: {
          ...resolveScanProfile("verified_deep_audit"),
          allowedChecks: ["deep-http-observation"],
        },
        resolveTxt: async () => [[token]],
        resolver: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
        requester,
      });
      await started;
      const [attempt] = await db
        .select()
        .from(scanAttempts)
        .where(eq(scanAttempts.scanId, f.scanId));
      await db
        .update(scanAttempts)
        .set({ leaseUntil: new Date(Date.now() - 1) })
        .where(eq(scanAttempts.id, attempt!.id));
      await expect(running).rejects.toThrow("aborted");
      expect(requester).toHaveBeenCalledOnce();
      expect(
        await db
          .select()
          .from(scanCheckRuns)
          .where(eq(scanCheckRuns.scanId, f.scanId)),
      ).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }, 12_000);

  it("blocks first site network after revalidation if grant or site changes", async () => {
    for (const change of [
      "revoke",
      "replace",
      "pause",
      "deactivate",
    ] as const) {
      const f = await fixture();
      const { db } = getDatabase();
      const lease = await claimDeepLease(f);
      const resolver = vi.fn(async () => [
        { address: "93.184.216.34", family: 4 as const },
      ]);
      const requester = vi.fn(async () => {
        throw new Error("No HTTP allowed");
      });
      try {
        const authorization = await revalidateDeepAuditAuthorization({
          siteId: f.siteId,
          organizationId: f.organizationId,
          resolveTxt: async () => [[token]],
        });
        if (!authorization.allowed || !authorization.grantIdentity)
          throw new Error("Fixture grant unavailable");
        const grantIdentity = authorization.grantIdentity;
        if (change === "revoke")
          await db
            .update(deepAuditAuthorizations)
            .set({ revokedAt: new Date() })
            .where(eq(deepAuditAuthorizations.siteId, f.siteId));
        if (change === "replace")
          await db
            .update(deepAuditAuthorizations)
            .set({ generationId: randomUUID() })
            .where(eq(deepAuditAuthorizations.siteId, f.siteId));
        if (change === "pause")
          await db
            .update(sites)
            .set({ status: "paused" })
            .where(eq(sites.id, f.siteId));
        if (change === "deactivate")
          await db
            .update(sites)
            .set({ status: "pending_verification", verifiedAt: null })
            .where(eq(sites.id, f.siteId));
        const profile = resolveScanProfile("verified_deep_audit");
        await expect(
          probeGuardedHttpTarget({
            targetUrl: "https://deep.example.test/",
            profile,
            authorization,
            scope: new ScopeGuard("https://deep.example.test/"),
            ledger: new BudgetLedger(profile.budget, Date.now()),
            beforeNetwork: () => assertDeepLease(lease, grantIdentity),
            transport: { resolver, requester },
          }),
        ).rejects.toThrow();
        expect(resolver).not.toHaveBeenCalled();
        expect(requester).not.toHaveBeenCalled();
      } finally {
        await releaseDeepLease(lease);
        await f.cleanup();
      }
    }
  });
});
