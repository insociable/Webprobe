CREATE TYPE "public"."report_delivery_status" AS ENUM('pending', 'sending', 'sent', 'cancelled');--> statement-breakpoint
CREATE TABLE "report_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_share_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"status" "report_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_deliveries_recipient_email_normalized" CHECK ("report_deliveries"."recipient_email" = lower(btrim("report_deliveries"."recipient_email"))),
	CONSTRAINT "report_deliveries_recipient_email_not_blank" CHECK (length(btrim("report_deliveries"."recipient_email")) > 0),
	CONSTRAINT "report_deliveries_attempt_count_nonnegative" CHECK ("report_deliveries"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "report_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_shares_token_hash_length" CHECK (length("report_shares"."token_hash") = 64),
	CONSTRAINT "report_shares_token_ciphertext_not_blank" CHECK (length(btrim("report_shares"."token_ciphertext")) > 0),
	CONSTRAINT "report_shares_expiry_after_creation" CHECK ("report_shares"."expires_at" > "report_shares"."created_at")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "report_brand_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "report_accent_color" text DEFAULT '#34d399' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_report_share_id_report_shares_id_fk" FOREIGN KEY ("report_share_id") REFERENCES "public"."report_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_deliveries_share_recipient_unique" ON "report_deliveries" USING btree ("report_share_id","recipient_email");--> statement-breakpoint
CREATE INDEX "report_deliveries_due_idx" ON "report_deliveries" USING btree ("next_attempt_at") WHERE "report_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "report_deliveries_lease_idx" ON "report_deliveries" USING btree ("lease_until") WHERE "report_deliveries"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "report_deliveries_org_idx" ON "report_deliveries" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_shares_token_hash_unique" ON "report_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "report_shares_scan_idx" ON "report_shares" USING btree ("organization_id","site_id","scan_id");--> statement-breakpoint
CREATE INDEX "report_shares_expires_idx" ON "report_shares" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_report_brand_name_not_blank" CHECK ("organizations"."report_brand_name" is null or length(btrim("organizations"."report_brand_name")) > 0);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_report_accent_color_hex" CHECK ("organizations"."report_accent_color" ~ '^#[0-9a-fA-F]{6}$');