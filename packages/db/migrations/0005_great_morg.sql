CREATE TABLE "scan_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"day_of_week" integer NOT NULL,
	"minute_of_day" integer NOT NULL,
	"time_zone" text DEFAULT 'Europe/Paris' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_schedules_day_of_week_range" CHECK ("scan_schedules"."day_of_week" between 1 and 7),
	CONSTRAINT "scan_schedules_minute_of_day_range" CHECK ("scan_schedules"."minute_of_day" between 0 and 1439),
	CONSTRAINT "scan_schedules_time_zone_not_blank" CHECK (length(btrim("scan_schedules"."time_zone")) > 0)
);
--> statement-breakpoint
ALTER TABLE "scan_schedules" ADD CONSTRAINT "scan_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_schedules" ADD CONSTRAINT "scan_schedules_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_schedules_site_unique" ON "scan_schedules" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "scan_schedules_org_idx" ON "scan_schedules" USING btree ("organization_id");