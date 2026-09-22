CREATE TYPE "public"."scan_attempt_status" AS ENUM('running', 'retrying', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scan_dispatch_status" AS ENUM('pending', 'dispatching', 'dispatched', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "scan_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "scan_attempt_status" DEFAULT 'running' NOT NULL,
	"retryable" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "scan_attempts_attempt_number_positive" CHECK ("scan_attempts"."attempt_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "scan_dispatches" (
	"scan_id" uuid PRIMARY KEY NOT NULL,
	"status" "scan_dispatch_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_dispatches_attempt_count_nonnegative" CHECK ("scan_dispatches"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "scan_attempts" ADD CONSTRAINT "scan_attempts_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_dispatches" ADD CONSTRAINT "scan_dispatches_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_attempts_scan_number_unique" ON "scan_attempts" USING btree ("scan_id","attempt_number");--> statement-breakpoint
CREATE INDEX "scan_attempts_scan_started_idx" ON "scan_attempts" USING btree ("scan_id","started_at");--> statement-breakpoint
CREATE INDEX "scan_dispatches_due_idx" ON "scan_dispatches" USING btree ("next_attempt_at") WHERE "scan_dispatches"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "scan_dispatches_lease_idx" ON "scan_dispatches" USING btree ("lease_until") WHERE "scan_dispatches"."status" = 'dispatching';--> statement-breakpoint
INSERT INTO "scan_dispatches" ("scan_id", "status", "next_attempt_at", "dispatched_at")
SELECT
  "id",
  CASE WHEN "status" = 'queued' THEN 'pending'::"scan_dispatch_status" ELSE 'dispatched'::"scan_dispatch_status" END,
  now(),
  CASE WHEN "status" = 'running' THEN now() ELSE NULL END
FROM "scans"
WHERE "status" IN ('queued', 'running')
ON CONFLICT ("scan_id") DO NOTHING;
