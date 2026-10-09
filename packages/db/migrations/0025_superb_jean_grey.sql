CREATE TABLE "third_party_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"status" text NOT NULL,
	"snapshot_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "third_party_decisions_status_valid" CHECK ("third_party_decisions"."status" in ('confirmed', 'ignored'))
);
--> statement-breakpoint
CREATE TABLE "third_party_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"confidence" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "third_party_observations_confidence_valid" CHECK ("third_party_observations"."confidence" in ('high', 'medium')),
	CONSTRAINT "third_party_observations_provider_valid" CHECK ("third_party_observations"."provider_id" ~ '^[a-z][a-z0-9-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "third_party_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"api_version" text NOT NULL,
	"provider_data" jsonb NOT NULL,
	"last_verified" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "third_party_snapshots_api_version_valid" CHECK ("third_party_snapshots"."api_version" = '1')
);
--> statement-breakpoint
ALTER TABLE "third_party_decisions" ADD CONSTRAINT "third_party_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_decisions" ADD CONSTRAINT "third_party_decisions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_decisions" ADD CONSTRAINT "third_party_decisions_snapshot_id_third_party_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."third_party_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_decisions" ADD CONSTRAINT "third_party_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_observations" ADD CONSTRAINT "third_party_observations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_observations" ADD CONSTRAINT "third_party_observations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_observations" ADD CONSTRAINT "third_party_observations_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_snapshots" ADD CONSTRAINT "third_party_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "third_party_snapshots" ADD CONSTRAINT "third_party_snapshots_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "third_party_decisions_org_site_provider_unique" ON "third_party_decisions" USING btree ("organization_id","site_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "third_party_observations_scan_provider_unique" ON "third_party_observations" USING btree ("scan_id","provider_id");--> statement-breakpoint
CREATE INDEX "third_party_observations_org_site_scan_idx" ON "third_party_observations" USING btree ("organization_id","site_id","scan_id");--> statement-breakpoint
CREATE INDEX "third_party_snapshots_org_site_provider_idx" ON "third_party_snapshots" USING btree ("organization_id","site_id","provider_id","fetched_at");