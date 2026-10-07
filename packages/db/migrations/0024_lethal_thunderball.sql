CREATE TABLE "finding_remediation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"remediation_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"scan_id" uuid,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_remediations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"scan_mode" "scan_mode" NOT NULL,
	"fingerprint" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"severity" "severity" NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"assignee_user_id" uuid,
	"due_at" timestamp with time zone,
	"acceptance_reason" text,
	"updated_by_user_id" uuid,
	"last_seen_scan_id" uuid,
	"suggested_scan_id" uuid,
	"reopened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_remediations_status_valid" CHECK ("finding_remediations"."status" in ('todo', 'in_progress', 'to_verify', 'fixed', 'accepted')),
	CONSTRAINT "finding_remediations_acceptance_reason" CHECK ("finding_remediations"."status" <> 'accepted' or length(btrim("finding_remediations"."acceptance_reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "site_import_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"imported_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_import_events_counts_nonnegative" CHECK ("site_import_events"."imported_count" >= 0 and "site_import_events"."skipped_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "finding_remediation_events" ADD CONSTRAINT "finding_remediation_events_remediation_id_finding_remediations_id_fk" FOREIGN KEY ("remediation_id") REFERENCES "public"."finding_remediations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_remediation_events" ADD CONSTRAINT "finding_remediation_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_remediation_events" ADD CONSTRAINT "finding_remediation_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_remediation_events" ADD CONSTRAINT "finding_remediation_events_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_remediations" ADD CONSTRAINT "finding_remediations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_remediations" ADD CONSTRAINT "finding_remediations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_remediations" ADD CONSTRAINT "finding_remediations_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_remediations" ADD CONSTRAINT "finding_remediations_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_remediations" ADD CONSTRAINT "finding_remediations_last_seen_scan_id_scans_id_fk" FOREIGN KEY ("last_seen_scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_remediations" ADD CONSTRAINT "finding_remediations_suggested_scan_id_scans_id_fk" FOREIGN KEY ("suggested_scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_import_events" ADD CONSTRAINT "site_import_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_import_events" ADD CONSTRAINT "site_import_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_remediation_events_remediation_time_idx" ON "finding_remediation_events" USING btree ("remediation_id","created_at");--> statement-breakpoint
CREATE INDEX "finding_remediation_events_org_idx" ON "finding_remediation_events" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_remediations_site_mode_fingerprint_unique" ON "finding_remediations" USING btree ("site_id","scan_mode","fingerprint");--> statement-breakpoint
CREATE INDEX "finding_remediations_org_status_idx" ON "finding_remediations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "site_import_events_org_time_idx" ON "site_import_events" USING btree ("organization_id","created_at");