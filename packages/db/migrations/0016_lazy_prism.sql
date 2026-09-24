CREATE TABLE "deep_audit_challenges" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"record_name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deep_audit_challenges_hash_valid" CHECK ("deep_audit_challenges"."token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "deep_audit_authorizations" ADD COLUMN "generation_id" uuid;--> statement-breakpoint
ALTER TABLE "scan_attempts" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scan_attempts" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "deep_audit_challenges" ADD CONSTRAINT "deep_audit_challenges_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deep_audit_challenges" ADD CONSTRAINT "deep_audit_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deep_audit_challenges_org_idx" ON "deep_audit_challenges" USING btree ("organization_id");