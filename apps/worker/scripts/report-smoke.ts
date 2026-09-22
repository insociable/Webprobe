import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import {
  createDatabase,
  organizations,
  reportDeliveries,
  reportShares,
  scans,
  sites,
  users,
} from "@agency-saas/db";
import {
  encryptReportShareToken,
  generateReportShareToken,
  hashReportShareToken,
} from "@agency-saas/security";
import { eq } from "drizzle-orm";
import { dispatchDueReportDeliveries } from "../src/report-delivery.js";
import { closeDatabase } from "../src/database.js";

config({ path: new URL("../../../.env", import.meta.url) });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const tokenSecret =
  process.env.REPORT_TOKEN_SECRET?.trim() ||
  process.env.BETTER_AUTH_SECRET?.trim();
if (!tokenSecret) {
  throw new Error("REPORT_TOKEN_SECRET or BETTER_AUTH_SECRET is required");
}

const database = createDatabase(databaseUrl);
const organizationId = randomUUID();
const siteId = randomUUID();
const scanId = randomUUID();
const userId = randomUUID();
const shareId = randomUUID();
const deliveryId = randomUUID();
const recipientEmail = "report-smoke-" + randomUUID() + "@example.invalid";
const now = new Date();
const token = generateReportShareToken();

async function mailpitMessages() {
  const port = process.env.MAILPIT_UI_PORT ?? "8025";
  const response = await fetch(
    "http://127.0.0.1:" + port + "/api/v1/messages?limit=100",
  );
  if (!response.ok) {
    throw new Error("Mailpit API returned " + response.status);
  }
  const body = (await response.json()) as Record<string, unknown>;
  const messages = body.messages ?? body.Messages;
  return Array.isArray(messages) ? messages : [];
}
try {
  await database.db.insert(users).values({
    id: userId,
    email: "report-smoke-owner-" + userId + "@example.invalid",
    displayName: "Report smoke owner",
  });
  await database.db.insert(organizations).values({
    id: organizationId,
    name: "Internal Smoke Agency",
    reportBrandName: "Smoke Agency",
    reportAccentColor: "#22c55e",
  });
  await database.db.insert(sites).values({
    id: siteId,
    organizationId,
    name: "Smoke Client Site",
    canonicalUrl: "https://example.com/",
    status: "active",
    verifiedAt: now,
  });
  await database.db.insert(scans).values({
    id: scanId,
    organizationId,
    siteId,
    trigger: "manual",
    status: "completed",
    pageCount: 1,
    completedAt: now,
  });
  await database.db.insert(reportShares).values({
    id: shareId,
    organizationId,
    siteId,
    scanId,
    tokenHash: hashReportShareToken(token),
    tokenCiphertext: encryptReportShareToken(token, tokenSecret),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
    createdByUserId: userId,
    createdAt: now,
  });
  await database.db.insert(reportDeliveries).values({
    id: deliveryId,
    reportShareId: shareId,
    organizationId,
    siteId,
    scanId,
    recipientEmail,
    nextAttemptAt: new Date(now.getTime() + 10 * 60_000),
  });

  const result = await dispatchDueReportDeliveries(
    undefined,
    new Date(now.getTime() + 11 * 60_000),
    1,
  );

  if (result.attempted !== 1 || result.sent !== 1 || result.failed !== 0) {
    throw new Error(
      "Unexpected report dispatch result: " + JSON.stringify(result),
    );
  }
  const [delivery] = await database.db
    .select({
      status: reportDeliveries.status,
      sentAt: reportDeliveries.sentAt,
    })
    .from(reportDeliveries)
    .where(eq(reportDeliveries.id, deliveryId));

  if (delivery?.status !== "sent" || !delivery.sentAt) {
    throw new Error("Report delivery was not marked sent");
  }

  const messages = await mailpitMessages();
  const expectedSubject = "[Smoke Agency] Rapport — Smoke Client Site";
  const match = messages.find((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const row = candidate as Record<string, unknown>;
    if (row.Subject !== expectedSubject && row.subject !== expectedSubject) {
      return false;
    }
    const to = row.To ?? row.to;
    return (
      Array.isArray(to) &&
      to.some((entry) => {
        if (typeof entry !== "object" || entry === null) return false;
        const address = (entry as Record<string, unknown>).Address;
        return address === recipientEmail;
      })
    );
  });

  if (!match) {
    throw new Error("Branded report email was not found in Mailpit");
  }

  console.log(
    JSON.stringify({
      recipientEmail,
      subject: expectedSubject,
      reportPathVerified: true,
      deliveryStatus: delivery.status,
      mailpitVerified: true,
    }),
  );
} finally {
  await database.db
    .delete(organizations)
    .where(eq(organizations.id, organizationId));
  await database.db.delete(users).where(eq(users.id, userId));
  await database.client.end();
  await closeDatabase();
}
