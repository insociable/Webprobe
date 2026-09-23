CREATE TYPE "public"."scan_mode" AS ENUM('public_audit', 'verified_monitoring');--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "scan_mode" "scan_mode" DEFAULT 'verified_monitoring' NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "requested_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scans_requester_mode_queued_idx" ON "scans" USING btree ("requested_by_user_id","scan_mode","queued_at");--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_mode_trigger_consistent" CHECK ("scans"."scan_mode" = 'verified_monitoring' or "scans"."trigger" = 'manual');