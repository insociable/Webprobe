CREATE TABLE "site_vulnerability_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"advisory_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_vulnerability_reviews_fingerprint_valid" CHECK ("site_vulnerability_reviews"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "site_vulnerability_reviews" ADD CONSTRAINT "site_vulnerability_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_vulnerability_reviews" ADD CONSTRAINT "site_vulnerability_reviews_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_vulnerability_reviews" ADD CONSTRAINT "site_vulnerability_reviews_advisory_id_vulnerability_advisories_id_fk" FOREIGN KEY ("advisory_id") REFERENCES "public"."vulnerability_advisories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_vulnerability_reviews" ADD CONSTRAINT "site_vulnerability_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_vulnerability_reviews_site_fingerprint_unique" ON "site_vulnerability_reviews" USING btree ("site_id","fingerprint");--> statement-breakpoint
CREATE INDEX "site_vulnerability_reviews_org_idx" ON "site_vulnerability_reviews" USING btree ("organization_id");