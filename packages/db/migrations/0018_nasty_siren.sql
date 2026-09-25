CREATE TABLE "site_vulnerability_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"advisory_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"matched_version" text,
	"affected_range" text,
	"fixed_version" text,
	"first_matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_vulnerability_matches_status_valid" CHECK ("site_vulnerability_matches"."status" in ('confirmed', 'potential'))
);
--> statement-breakpoint
CREATE TABLE "technology_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"category" text NOT NULL,
	"vendor" text NOT NULL,
	"product" text NOT NULL,
	"version" text,
	"version_confidence" text DEFAULT 'unknown' NOT NULL,
	"detection_confidence" text DEFAULT 'high' NOT NULL,
	"source" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technology_observations_version_confidence_valid" CHECK ("technology_observations"."version_confidence" in ('exact', 'partial', 'unknown')),
	CONSTRAINT "technology_observations_detection_confidence_valid" CHECK ("technology_observations"."detection_confidence" in ('high', 'medium')),
	CONSTRAINT "technology_observations_product_not_blank" CHECK (length(btrim("technology_observations"."product")) > 0 and length(btrim("technology_observations"."vendor")) > 0)
);
--> statement-breakpoint
CREATE TABLE "vulnerability_advisories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cve_id" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone,
	"modified_at" timestamp with time zone,
	"severity" "severity",
	"cvss_score_tenths" integer,
	"cvss_vector" text,
	"known_exploited" boolean DEFAULT false NOT NULL,
	"known_exploited_at" timestamp with time zone,
	"known_ransomware_use" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vulnerability_advisories_cve_format" CHECK ("vulnerability_advisories"."cve_id" ~ '^CVE-[0-9]{4}-[0-9]{4,}$'),
	CONSTRAINT "vulnerability_advisories_cvss_range" CHECK ("vulnerability_advisories"."cvss_score_tenths" is null or "vulnerability_advisories"."cvss_score_tenths" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "vulnerability_affected_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advisory_id" uuid NOT NULL,
	"source" text DEFAULT 'nvd' NOT NULL,
	"vendor" text NOT NULL,
	"product" text NOT NULL,
	"criteria" text,
	"version_exact" text,
	"version_start_including" text,
	"version_start_excluding" text,
	"version_end_including" text,
	"version_end_excluding" text,
	"context_required" boolean DEFAULT false NOT NULL,
	"raw_rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "vulnerability_affected_products_source_valid" CHECK ("vulnerability_affected_products"."source" = 'nvd'),
	CONSTRAINT "vulnerability_affected_products_names_not_blank" CHECK (length(btrim("vulnerability_affected_products"."vendor")) > 0 and length(btrim("vulnerability_affected_products"."product")) > 0)
);
--> statement-breakpoint
CREATE TABLE "vulnerability_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advisory_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vulnerability_sources_source_valid" CHECK ("vulnerability_sources"."source" in ('nvd', 'cisa_kev'))
);
--> statement-breakpoint
CREATE TABLE "vulnerability_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"cursor_start" timestamp with time zone,
	"cursor_end" timestamp with time zone,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "vulnerability_sync_runs_source_valid" CHECK ("vulnerability_sync_runs"."source" in ('nvd', 'cisa_kev')),
	CONSTRAINT "vulnerability_sync_runs_status_valid" CHECK ("vulnerability_sync_runs"."status" in ('running', 'completed', 'failed')),
	CONSTRAINT "vulnerability_sync_runs_counts_nonnegative" CHECK ("vulnerability_sync_runs"."fetched" >= 0 and "vulnerability_sync_runs"."created" >= 0 and "vulnerability_sync_runs"."updated" >= 0 and "vulnerability_sync_runs"."failed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "site_vulnerability_matches" ADD CONSTRAINT "site_vulnerability_matches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_vulnerability_matches" ADD CONSTRAINT "site_vulnerability_matches_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_vulnerability_matches" ADD CONSTRAINT "site_vulnerability_matches_observation_id_technology_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."technology_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_vulnerability_matches" ADD CONSTRAINT "site_vulnerability_matches_advisory_id_vulnerability_advisories_id_fk" FOREIGN KEY ("advisory_id") REFERENCES "public"."vulnerability_advisories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technology_observations" ADD CONSTRAINT "technology_observations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technology_observations" ADD CONSTRAINT "technology_observations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technology_observations" ADD CONSTRAINT "technology_observations_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulnerability_affected_products" ADD CONSTRAINT "vulnerability_affected_products_advisory_id_vulnerability_advisories_id_fk" FOREIGN KEY ("advisory_id") REFERENCES "public"."vulnerability_advisories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulnerability_sources" ADD CONSTRAINT "vulnerability_sources_advisory_id_vulnerability_advisories_id_fk" FOREIGN KEY ("advisory_id") REFERENCES "public"."vulnerability_advisories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_vulnerability_matches_observation_advisory_unique" ON "site_vulnerability_matches" USING btree ("observation_id","advisory_id");--> statement-breakpoint
CREATE INDEX "site_vulnerability_matches_site_status_idx" ON "site_vulnerability_matches" USING btree ("site_id","status","last_matched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "technology_observations_scan_product_source_unique" ON "technology_observations" USING btree ("scan_id","vendor","product","source");--> statement-breakpoint
CREATE INDEX "technology_observations_site_product_idx" ON "technology_observations" USING btree ("site_id","vendor","product","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vulnerability_advisories_cve_unique" ON "vulnerability_advisories" USING btree ("cve_id");--> statement-breakpoint
CREATE INDEX "vulnerability_advisories_modified_idx" ON "vulnerability_advisories" USING btree ("modified_at");--> statement-breakpoint
CREATE INDEX "vulnerability_advisories_kev_idx" ON "vulnerability_advisories" USING btree ("known_exploited") WHERE "vulnerability_advisories"."known_exploited" = true;--> statement-breakpoint
CREATE INDEX "vulnerability_affected_products_lookup_idx" ON "vulnerability_affected_products" USING btree ("vendor","product");--> statement-breakpoint
CREATE INDEX "vulnerability_affected_products_advisory_idx" ON "vulnerability_affected_products" USING btree ("advisory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vulnerability_sources_source_key_unique" ON "vulnerability_sources" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "vulnerability_sources_advisory_idx" ON "vulnerability_sources" USING btree ("advisory_id");--> statement-breakpoint
CREATE INDEX "vulnerability_sync_runs_source_started_idx" ON "vulnerability_sync_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vulnerability_sync_runs_source_running_unique" ON "vulnerability_sync_runs" USING btree ("source") WHERE "vulnerability_sync_runs"."status" = 'running';