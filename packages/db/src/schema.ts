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

export const scanMode = pgEnum("scan_mode", [
  "public_audit",
  "verified_monitoring",
  "verified_deep_audit",
]);

export const scanDispatchStatus = pgEnum("scan_dispatch_status", [
  "pending",
  "dispatching",
  "dispatched",
  "failed",
  "cancelled",
]);

export const scanAttemptStatus = pgEnum("scan_attempt_status", [
  "running",
  "retrying",
  "completed",
  "failed",
]);

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

export const reportDeliveryStatus = pgEnum("report_delivery_status", [
  "pending",
  "sending",
  "sent",
  "cancelled",
]);

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

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    reportBrandName: text("report_brand_name"),
    reportAccentColor: text("report_accent_color").default("#34d399").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "organizations_report_brand_name_not_blank",
      sql`${table.reportBrandName} is null or length(btrim(${table.reportBrandName})) > 0`,
    ),
    check(
      "organizations_report_accent_color_hex",
      sql`${table.reportAccentColor} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
  ],
);

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

export const deepAuditAuthorizations = pgTable(
  "deep_audit_authorizations",
  {
    siteId: uuid("site_id")
      .primaryKey()
      .references(() => sites.id, { onDelete: "cascade" }),
    proofType: text("proof_type").notNull(),
    proofRecordName: text("proof_record_name"),
    proofTokenHash: text("proof_token_hash"),
    proofVerifiedAt: timestamp("proof_verified_at", {
      withTimezone: true,
    }).notNull(),
    revalidatedAt: timestamp("revalidated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    generationId: uuid("generation_id").notNull(),
  },
  (table) => [
    check("deep_audit_proof_type_dns", sql`${table.proofType} = 'dns_txt'`),
    check(
      "deep_audit_expiry_after_proof",
      sql`${table.expiresAt} > ${table.proofVerifiedAt}`,
    ),
    check(
      "deep_audit_proof_hash_valid",
      sql`${table.proofTokenHash} is null or ${table.proofTokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const deepAuditChallenges = pgTable(
  "deep_audit_challenges",
  {
    siteId: uuid("site_id")
      .primaryKey()
      .references(() => sites.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    generationId: uuid("generation_id").notNull(),
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
    index("deep_audit_challenges_org_idx").on(table.organizationId),
    check(
      "deep_audit_challenges_hash_valid",
      sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
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
    scanMode: scanMode("scan_mode").default("verified_monitoring").notNull(),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("scans_requester_mode_queued_idx").on(
      table.requestedByUserId,
      table.scanMode,
      table.queuedAt,
    ),
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
    check(
      "scans_mode_trigger_consistent",
      sql`${table.scanMode} = 'verified_monitoring' or ${table.trigger} = 'manual'`,
    ),
  ],
);

export const scanCheckRuns = pgTable(
  "scan_check_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    checkId: text("check_id").notNull(),
    checkVersion: text("check_version").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    budgetUsed: jsonb("budget_used")
      .$type<Record<string, number>>()
      .default({})
      .notNull(),
    evidence: jsonb("evidence")
      .$type<ReadonlyArray<Record<string, unknown>>>()
      .default([])
      .notNull(),
    skipReason: text("skip_reason"),
  },
  (table) => [
    index("scan_check_runs_scan_idx").on(table.scanId),
    check(
      "scan_check_runs_status_valid",
      sql`${table.status} in ('completed', 'skipped', 'failed')`,
    ),
    check(
      "scan_check_runs_duration_nonnegative",
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
  ],
);

export const scanDispatches = pgTable(
  "scan_dispatches",
  {
    scanId: uuid("scan_id")
      .primaryKey()
      .references(() => scans.id, { onDelete: "cascade" }),
    status: scanDispatchStatus("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("scan_dispatches_due_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    index("scan_dispatches_lease_idx")
      .on(table.leaseUntil)
      .where(sql`${table.status} = 'dispatching'`),
    check(
      "scan_dispatches_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);

export const scanAttempts = pgTable(
  "scan_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: scanAttemptStatus("status").default("running").notNull(),
    retryable: boolean("retryable").default(false).notNull(),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
  },
  (table) => [
    uniqueIndex("scan_attempts_scan_number_unique").on(
      table.scanId,
      table.attemptNumber,
    ),
    index("scan_attempts_scan_started_idx").on(table.scanId, table.startedAt),
    check(
      "scan_attempts_attempt_number_positive",
      sql`${table.attemptNumber} > 0`,
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

export const scanArtifacts = pgTable(
  "scan_artifacts",
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
    kind: text("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    mediaType: text("media_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("scan_artifacts_scan_kind_unique").on(table.scanId, table.kind),
    uniqueIndex("scan_artifacts_storage_key_unique").on(table.storageKey),
    index("scan_artifacts_org_site_idx").on(
      table.organizationId,
      table.siteId,
      table.scanId,
    ),
    check(
      "scan_artifacts_kind_supported",
      sql`${table.kind} = 'primary-screenshot'`,
    ),
    check(
      "scan_artifacts_media_type_supported",
      sql`${table.mediaType} = 'image/jpeg'`,
    ),
    check("scan_artifacts_byte_size_positive", sql`${table.byteSize} > 0`),
    check("scan_artifacts_sha256_length", sql`length(${table.sha256}) = 64`),
    check(
      "scan_artifacts_storage_key_not_blank",
      sql`length(btrim(${table.storageKey})) > 0`,
    ),
  ],
);

export const reportShares = pgTable(
  "report_shares",
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
    tokenHash: text("token_hash").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("report_shares_token_hash_unique").on(table.tokenHash),
    index("report_shares_scan_idx").on(
      table.organizationId,
      table.siteId,
      table.scanId,
    ),
    index("report_shares_expires_idx").on(table.expiresAt),
    check(
      "report_shares_token_hash_length",
      sql`length(${table.tokenHash}) = 64`,
    ),
    check(
      "report_shares_token_ciphertext_not_blank",
      sql`length(btrim(${table.tokenCiphertext})) > 0`,
    ),
    check(
      "report_shares_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const reportDeliveries = pgTable(
  "report_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportShareId: uuid("report_share_id")
      .notNull()
      .references(() => reportShares.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    recipientEmail: text("recipient_email").notNull(),
    status: reportDeliveryStatus("status").default("pending").notNull(),
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
    uniqueIndex("report_deliveries_share_recipient_unique").on(
      table.reportShareId,
      table.recipientEmail,
    ),
    index("report_deliveries_due_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    index("report_deliveries_lease_idx")
      .on(table.leaseUntil)
      .where(sql`${table.status} = 'sending'`),
    index("report_deliveries_org_idx").on(table.organizationId),
    check(
      "report_deliveries_recipient_email_normalized",
      sql`${table.recipientEmail} = lower(btrim(${table.recipientEmail}))`,
    ),
    check(
      "report_deliveries_recipient_email_not_blank",
      sql`length(btrim(${table.recipientEmail})) > 0`,
    ),
    check(
      "report_deliveries_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
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

export const technologyObservations = pgTable(
  "technology_observations",
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
    category: text("category").notNull(),
    vendor: text("vendor").notNull(),
    product: text("product").notNull(),
    version: text("version"),
    versionConfidence: text("version_confidence").default("unknown").notNull(),
    detectionConfidence: text("detection_confidence").default("high").notNull(),
    source: text("source").notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("technology_observations_scan_product_source_unique").on(
      table.scanId,
      table.vendor,
      table.product,
      table.source,
    ),
    index("technology_observations_site_product_idx").on(
      table.siteId,
      table.vendor,
      table.product,
      table.observedAt,
    ),
    check(
      "technology_observations_version_confidence_valid",
      sql`${table.versionConfidence} in ('exact', 'partial', 'unknown')`,
    ),
    check(
      "technology_observations_detection_confidence_valid",
      sql`${table.detectionConfidence} in ('high', 'medium')`,
    ),
    check(
      "technology_observations_product_not_blank",
      sql`length(btrim(${table.product})) > 0 and length(btrim(${table.vendor})) > 0`,
    ),
  ],
);

export const vulnerabilityAdvisories = pgTable(
  "vulnerability_advisories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cveId: text("cve_id").notNull(),
    summary: text("summary").default("").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),
    severity: severity("severity"),
    cvssScoreTenths: integer("cvss_score_tenths"),
    cvssVector: text("cvss_vector"),
    knownExploited: boolean("known_exploited").default(false).notNull(),
    knownExploitedAt: timestamp("known_exploited_at", { withTimezone: true }),
    knownRansomwareUse: text("known_ransomware_use"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("vulnerability_advisories_cve_unique").on(table.cveId),
    index("vulnerability_advisories_modified_idx").on(table.modifiedAt),
    index("vulnerability_advisories_kev_idx")
      .on(table.knownExploited)
      .where(sql`${table.knownExploited} = true`),
    check(
      "vulnerability_advisories_cve_format",
      sql`${table.cveId} ~ '^CVE-[0-9]{4}-[0-9]{4,}$'`,
    ),
    check(
      "vulnerability_advisories_cvss_range",
      sql`${table.cvssScoreTenths} is null or ${table.cvssScoreTenths} between 0 and 100`,
    ),
  ],
);

export const vulnerabilitySources = pgTable(
  "vulnerability_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    advisoryId: uuid("advisory_id")
      .notNull()
      .references(() => vulnerabilityAdvisories.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceKey: text("source_key").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("vulnerability_sources_source_key_unique").on(
      table.source,
      table.sourceKey,
    ),
    index("vulnerability_sources_advisory_idx").on(table.advisoryId),
    check(
      "vulnerability_sources_source_valid",
      sql`${table.source} in ('nvd', 'cisa_kev')`,
    ),
  ],
);

export const vulnerabilityAffectedProducts = pgTable(
  "vulnerability_affected_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    advisoryId: uuid("advisory_id")
      .notNull()
      .references(() => vulnerabilityAdvisories.id, { onDelete: "cascade" }),
    source: text("source").default("nvd").notNull(),
    vendor: text("vendor").notNull(),
    product: text("product").notNull(),
    criteria: text("criteria"),
    versionExact: text("version_exact"),
    versionStartIncluding: text("version_start_including"),
    versionStartExcluding: text("version_start_excluding"),
    versionEndIncluding: text("version_end_including"),
    versionEndExcluding: text("version_end_excluding"),
    contextRequired: boolean("context_required").default(false).notNull(),
    rawRule: jsonb("raw_rule")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
  },
  (table) => [
    index("vulnerability_affected_products_lookup_idx").on(
      table.vendor,
      table.product,
    ),
    index("vulnerability_affected_products_advisory_idx").on(table.advisoryId),
    check(
      "vulnerability_affected_products_source_valid",
      sql`${table.source} = 'nvd'`,
    ),
    check(
      "vulnerability_affected_products_names_not_blank",
      sql`length(btrim(${table.vendor})) > 0 and length(btrim(${table.product})) > 0`,
    ),
  ],
);

export const vulnerabilitySyncRuns = pgTable(
  "vulnerability_sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    scopeKey: text("scope_key"),
    status: text("status").default("running").notNull(),
    cursorStart: timestamp("cursor_start", { withTimezone: true }),
    cursorEnd: timestamp("cursor_end", { withTimezone: true }),
    fetched: integer("fetched").default(0).notNull(),
    created: integer("created").default(0).notNull(),
    updated: integer("updated").default(0).notNull(),
    failed: integer("failed").default(0).notNull(),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("vulnerability_sync_runs_source_started_idx").on(
      table.source,
      table.startedAt,
    ),
    index("vulnerability_sync_runs_source_scope_completed_idx").on(
      table.source,
      table.scopeKey,
      table.completedAt,
    ),
    uniqueIndex("vulnerability_sync_runs_source_running_unique")
      .on(table.source)
      .where(sql`${table.status} = 'running'`),
    check(
      "vulnerability_sync_runs_source_valid",
      sql`${table.source} in ('nvd', 'cisa_kev')`,
    ),
    check(
      "vulnerability_sync_runs_status_valid",
      sql`${table.status} in ('running', 'completed', 'failed')`,
    ),
    check(
      "vulnerability_sync_runs_counts_nonnegative",
      sql`${table.fetched} >= 0 and ${table.created} >= 0 and ${table.updated} >= 0 and ${table.failed} >= 0`,
    ),
  ],
);

export const siteVulnerabilityMatches = pgTable(
  "site_vulnerability_matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    observationId: uuid("observation_id")
      .notNull()
      .references(() => technologyObservations.id, { onDelete: "cascade" }),
    advisoryId: uuid("advisory_id")
      .notNull()
      .references(() => vulnerabilityAdvisories.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    matchedVersion: text("matched_version"),
    affectedRange: text("affected_range"),
    fixedVersion: text("fixed_version"),
    firstMatchedAt: timestamp("first_matched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("site_vulnerability_matches_observation_advisory_unique").on(
      table.observationId,
      table.advisoryId,
    ),
    index("site_vulnerability_matches_site_status_idx").on(
      table.siteId,
      table.status,
      table.lastMatchedAt,
    ),
    check(
      "site_vulnerability_matches_status_valid",
      sql`${table.status} in ('confirmed', 'potential')`,
    ),
  ],
);
