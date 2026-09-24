import { z } from "zod";

export const WORKER_HEALTH_KEY = "agency-monitor:worker-health:v1";
export const WORKER_HEARTBEAT_TTL_SECONDS = 45;
export const WORKER_HEARTBEAT_STALE_MS = 30_000;

const ComponentStatusSchema = z.enum(["up", "down"]);

export const WorkerHealthSnapshotSchema = z.object({
  version: z.literal(1),
  checkedAt: z.string().datetime(),
  database: z.object({
    status: ComponentStatusSchema,
    scansRunning: z.number().int().nonnegative(),
    scansStale: z.number().int().nonnegative(),
    deepScansRunning: z.number().int().nonnegative().default(0),
    deepScansStale: z.number().int().nonnegative().default(0),
    deepSuccessLast24h: z.number().int().nonnegative().default(0),
    deepFailedLast24h: z.number().int().nonnegative().default(0),
    successLast24h: z.number().int().nonnegative(),
    failedLast24h: z.number().int().nonnegative(),
    successRateLast24h: z.number().min(0).max(1).nullable(),
    averageDurationMsLast24h: z.number().nonnegative().nullable(),
    dispatchPending: z.number().int().nonnegative(),
    dispatchErrors: z.number().int().nonnegative(),
  }),
  queue: z.object({
    status: ComponentStatusSchema,
    waiting: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    delayed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    backlog: z.number().int().nonnegative(),
    oldestPendingAgeMs: z.number().int().nonnegative().nullable(),
  }),
  browser: z.object({
    status: ComponentStatusSchema,
    checkedAt: z.string().datetime(),
  }),
});

export type WorkerHealthSnapshot = z.infer<typeof WorkerHealthSnapshotSchema>;
