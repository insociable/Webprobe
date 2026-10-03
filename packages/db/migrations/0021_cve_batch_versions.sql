CREATE TABLE "site_technology_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"version" text NOT NULL,
	"declared_by" uuid,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_technology_versions_version_format" CHECK ("site_technology_versions"."version" ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')
);
--> statement-breakpoint
ALTER TABLE "site_technology_versions" ADD CONSTRAINT "site_technology_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_technology_versions" ADD CONSTRAINT "site_technology_versions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_technology_versions" ADD CONSTRAINT "site_technology_versions_observation_id_technology_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."technology_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_technology_versions" ADD CONSTRAINT "site_technology_versions_declared_by_users_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_technology_versions_observation_unique" ON "site_technology_versions" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "site_technology_versions_org_site_idx" ON "site_technology_versions" USING btree ("organization_id","site_id");