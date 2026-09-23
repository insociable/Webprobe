ALTER TYPE "public"."scan_mode" ADD VALUE 'verified_deep_audit';--> statement-breakpoint
CREATE TABLE "deep_audit_authorizations" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"proof_type" text NOT NULL,
	"proof_verified_at" timestamp with time zone NOT NULL,
	"revalidated_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "deep_audit_proof_type_dns" CHECK ("deep_audit_authorizations"."proof_type" = 'dns_txt'),
	CONSTRAINT "deep_audit_expiry_after_proof" CHECK ("deep_audit_authorizations"."expires_at" > "deep_audit_authorizations"."proof_verified_at")
);
--> statement-breakpoint
CREATE TABLE "scan_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"check_id" text NOT NULL,
	"check_version" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"budget_used" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skip_reason" text,
	CONSTRAINT "scan_check_runs_status_valid" CHECK ("scan_check_runs"."status" in ('completed', 'skipped', 'failed')),
	CONSTRAINT "scan_check_runs_duration_nonnegative" CHECK ("scan_check_runs"."duration_ms" is null or "scan_check_runs"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "deep_audit_authorizations" ADD CONSTRAINT "deep_audit_authorizations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_check_runs" ADD CONSTRAINT "scan_check_runs_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_check_runs_scan_idx" ON "scan_check_runs" USING btree ("scan_id");