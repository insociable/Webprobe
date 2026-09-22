import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Queue, QueueEvents } from "bullmq";
import { and, eq } from "drizzle-orm";
import { SCAN_QUEUE_NAME } from "@agency-saas/contracts";
import {
  createDatabase,
  findings,
  organizations,
  scans,
  sites,
} from "@agency-saas/db";

config({ path: new URL("../../../.env", import.meta.url) });

const redisUrlValue = process.env.REDIS_URL;
const databaseUrlValue = process.env.DATABASE_URL;
if (!redisUrlValue) {
  throw new Error("REDIS_URL is required");
}
if (!databaseUrlValue) {
  throw new Error("DATABASE_URL is required");
}

const redisUrl = new URL(redisUrlValue);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
};

const database = createDatabase(databaseUrlValue);
const events = new QueueEvents(SCAN_QUEUE_NAME, { connection });
const queue = new Queue(SCAN_QUEUE_NAME, { connection });

const organizationId = randomUUID();
const publicSiteId = randomUUID();
const privateSiteId = randomUUID();
const publicScanId = randomUUID();
const privateScanId = randomUUID();

try {
  await database.db.insert(organizations).values({
    id: organizationId,
    name: "Worker smoke organization",
  });

  await database.db.insert(sites).values([
    {
      id: publicSiteId,
      organizationId,
      name: "Public smoke target",
      canonicalUrl: "https://example.com/",
      status: "active",
      verifiedAt: new Date(),
    },
    {
      id: privateSiteId,
      organizationId,
      name: "Private smoke target",
      canonicalUrl: "http://127.0.0.1/",
      status: "active",
      verifiedAt: new Date(),
    },
  ]);

  await database.db.insert(scans).values([
    {
      id: publicScanId,
      organizationId,
      siteId: publicSiteId,
      trigger: "manual",
    },
    {
      id: privateScanId,
      organizationId,
      siteId: privateSiteId,
      trigger: "manual",
    },
  ]);

  await events.waitUntilReady();

  const publicJob = await queue.add(
    "smoke-public",
    {
      scanId: publicScanId,
      organizationId,
      siteId: publicSiteId,
      targetUrl: "https://example.com/",
    },
    { removeOnComplete: true, removeOnFail: true },
  );
  const publicResult = await publicJob.waitUntilFinished(events, 15_000);

  const privateJob = await queue.add(
    "smoke-private",
    {
      scanId: privateScanId,
      organizationId,
      siteId: privateSiteId,
      targetUrl: "http://127.0.0.1/",
    },
    { removeOnComplete: true, removeOnFail: true },
  );

  let privateTargetRejected = false;
  try {
    await privateJob.waitUntilFinished(events, 15_000);
  } catch {
    privateTargetRejected = true;
  }

  if (!publicResult.http?.ok || publicResult.status !== "completed") {
    throw new Error("Public target scan did not complete");
  }
  if (!privateTargetRejected) {
    throw new Error("Private target was unexpectedly accepted");
  }

  const persistedScans = await database.db
    .select({
      id: scans.id,
      status: scans.status,
      summary: scans.summary,
    })
    .from(scans)
    .where(
      and(
        eq(scans.organizationId, organizationId),
        eq(scans.trigger, "manual"),
      ),
    );

  const publicPersisted = persistedScans.find(
    (item) => item.id === publicScanId,
  );
  const privatePersisted = persistedScans.find(
    (item) => item.id === privateScanId,
  );

  if (publicPersisted?.status !== "completed") {
    throw new Error("Public scan was not persisted as completed");
  }
  if (privatePersisted?.status !== "failed") {
    throw new Error("Private scan was not persisted as failed");
  }

  const persistedFindings = await database.db
    .select({ id: findings.id })
    .from(findings)
    .where(
      and(
        eq(findings.organizationId, organizationId),
        eq(findings.scanId, publicScanId),
      ),
    );

  if (persistedFindings.length !== publicResult.findings.length) {
    throw new Error("Persisted finding count does not match worker result");
  }

  console.log(
    JSON.stringify({
      ok: true,
      publicTarget: publicResult.http.finalUrl,
      publicStatus: publicResult.http.statusCode,
      publicFindings: publicResult.findings.length,
      privateTargetRejected,
      persistenceVerified: true,
    }),
  );
} finally {
  await database.db
    .delete(organizations)
    .where(eq(organizations.id, organizationId));
  await Promise.all([events.close(), queue.close()]);
  await database.client.end();
}
