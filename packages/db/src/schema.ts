import {
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
