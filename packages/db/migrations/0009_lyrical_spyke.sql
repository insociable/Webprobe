CREATE TABLE "recipient_finding_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"page_url" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_alerted_severity" "severity" NOT NULL,
	"opened_scan_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_scan_id" uuid,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipient_finding_incidents_fingerprint_not_blank" CHECK (length(btrim("recipient_finding_incidents"."fingerprint")) > 0)
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_kind_supported";--> statement-breakpoint
ALTER TABLE "recipient_finding_incidents" ADD CONSTRAINT "recipient_finding_incidents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_finding_incidents" ADD CONSTRAINT "recipient_finding_incidents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_finding_incidents" ADD CONSTRAINT "recipient_finding_incidents_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_finding_incidents" ADD CONSTRAINT "recipient_finding_incidents_opened_scan_id_scans_id_fk" FOREIGN KEY ("opened_scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_finding_incidents" ADD CONSTRAINT "recipient_finding_incidents_resolved_scan_id_scans_id_fk" FOREIGN KEY ("resolved_scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipient_finding_incidents_recipient_site_fingerprint_unique" ON "recipient_finding_incidents" USING btree ("recipient_user_id","site_id","fingerprint");--> statement-breakpoint
CREATE INDEX "recipient_finding_incidents_active_site_idx" ON "recipient_finding_incidents" USING btree ("site_id","recipient_user_id") WHERE "recipient_finding_incidents"."active" = true;--> statement-breakpoint
CREATE INDEX "recipient_finding_incidents_org_idx" ON "recipient_finding_incidents" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_kind_supported" CHECK ("notification_deliveries"."kind" in ('scan-degradation', 'scan-recovery'));