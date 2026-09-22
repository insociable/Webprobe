CREATE TABLE "site_verification_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"record_name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_verification_challenges" ADD CONSTRAINT "site_verification_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_verification_challenges" ADD CONSTRAINT "site_verification_challenges_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_verification_challenges_site_unique" ON "site_verification_challenges" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "site_verification_challenges_org_idx" ON "site_verification_challenges" USING btree ("organization_id");