import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const siteStatus = pgEnum("site_status", [
  "pending_verification",
  "active",
  "paused",
]);

export const scanStatus = pgEnum("scan_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const scanTrigger = pgEnum("scan_trigger", ["manual", "scheduled"]);

export const severity = pgEnum("severity", [
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

export const organizationRole = pgEnum("organization_role", [
  "owner",
  "admin",
  "member",
]);

export const notificationDeliveryStatus = pgEnum(
  "notification_delivery_status",
  ["pending", "sending", "sent"],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check(
      "users_email_normalized",
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organizationRole("role").default("member").notNull(),
    scanAlertEnabled: boolean("scan_alert_enabled").default(true).notNull(),
    scanAlertMinimumSeverity: severity("scan_alert_minimum_severity")
      .default("medium")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("memberships_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    index("memberships_user_idx").on(table.userId),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("auth_sessions_userId_idx").on(table.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("auth_accounts_userId_idx").on(table.userId)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    status: siteStatus("status").default("pending_verification").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sites_org_url_unique").on(
      table.organizationId,
      table.canonicalUrl,
    ),
    index("sites_org_idx").on(table.organizationId),
  ],
);

export const siteVerificationChallenges = pgTable(
  "site_verification_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    recordName: text("record_name").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("site_verification_challenges_site_unique").on(table.siteId),
    index("site_verification_challenges_org_idx").on(table.organizationId),
  ],
);

export const scanSchedules = pgTable(
  "scan_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(true).notNull(),
    dayOfWeek: integer("day_of_week").notNull(),
    minuteOfDay: integer("minute_of_day").notNull(),
    timeZone: text("time_zone").default("Europe/Paris").notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("scan_schedules_site_unique").on(table.siteId),
    index("scan_schedules_org_idx").on(table.organizationId),
    index("scan_schedules_due_idx")
      .on(table.nextRunAt)
      .where(sql`${table.enabled} = true`),
    check(
      "scan_schedules_day_of_week_range",
      sql`${table.dayOfWeek} between 1 and 7`,
    ),
    check(
      "scan_schedules_minute_of_day_range",
      sql`${table.minuteOfDay} between 0 and 1439`,
    ),
    check(
      "scan_schedules_time_zone_not_blank",
      sql`length(btrim(${table.timeZone})) > 0`,
    ),
  ],
);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    status: scanStatus("status").default("queued").notNull(),
    trigger: scanTrigger("trigger").notNull(),
    scheduleId: uuid("schedule_id").references(() => scanSchedules.id, {
      onDelete: "set null",
    }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    pageCount: integer("page_count").default(0).notNull(),
    summary: jsonb("summary")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("scans_org_idx").on(table.organizationId),
    index("scans_site_queued_idx").on(table.siteId, table.queuedAt),
    uniqueIndex("scans_site_active_unique")
      .on(table.siteId)
      .where(sql`${table.status} in ('queued', 'running')`),
    uniqueIndex("scans_schedule_occurrence_unique")
      .on(table.scheduleId, table.scheduledFor)
      .where(
        sql`${table.trigger} = 'scheduled' and ${table.scheduleId} is not null`,
      ),
    check(
      "scans_scheduled_metadata_consistent",
      sql`(${table.trigger} = 'manual' and ${table.scheduleId} is null and ${table.scheduledFor} is null)
          or (${table.trigger} = 'scheduled' and ${table.scheduledFor} is not null)`,
    ),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    severity: severity("severity").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    pageUrl: text("page_url"),
    fingerprint: text("fingerprint").notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("findings_org_idx").on(table.organizationId),
    index("findings_scan_idx").on(table.scanId),
    uniqueIndex("findings_scan_fingerprint_unique").on(
      table.scanId,
      table.fingerprint,
    ),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientEmail: text("recipient_email").notNull(),
    kind: text("kind").default("scan-degradation").notNull(),
    status: notificationDeliveryStatus("status").default("pending").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_scan_recipient_kind_unique").on(
      table.scanId,
      table.recipientUserId,
      table.kind,
    ),
    index("notification_deliveries_org_idx").on(table.organizationId),
    index("notification_deliveries_due_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    index("notification_deliveries_lease_idx")
      .on(table.leaseUntil)
      .where(sql`${table.status} = 'sending'`),
    check(
      "notification_deliveries_kind_supported",
      sql`${table.kind} in ('scan-degradation', 'scan-recovery')`,
    ),
    check(
      "notification_deliveries_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "notification_deliveries_recipient_email_not_blank",
      sql`length(btrim(${table.recipientEmail})) > 0`,
    ),
  ],
);

export const recipientFindingIncidents = pgTable(
  "recipient_finding_incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    pageUrl: text("page_url").notNull(),
    active: boolean("active").default(true).notNull(),
    lastAlertedSeverity: severity("last_alerted_severity").notNull(),
    openedScanId: uuid("opened_scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedScanId: uuid("resolved_scan_id").references(() => scans.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex(
      "recipient_finding_incidents_recipient_site_fingerprint_unique",
    ).on(table.recipientUserId, table.siteId, table.fingerprint),
    index("recipient_finding_incidents_active_site_idx")
      .on(table.siteId, table.recipientUserId)
      .where(sql`${table.active} = true`),
    index("recipient_finding_incidents_org_idx").on(table.organizationId),
    check(
      "recipient_finding_incidents_fingerprint_not_blank",
      sql`length(btrim(${table.fingerprint})) > 0`,
    ),
  ],
);
