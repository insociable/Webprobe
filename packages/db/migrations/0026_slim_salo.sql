CREATE TABLE "deep_crawl_consents" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"canonical_url" text NOT NULL,
	"ownership_generation" uuid NOT NULL,
	"deep_generation_id" uuid NOT NULL,
	"allowed_path_prefixes" jsonb NOT NULL,
	"max_pages" integer NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deep_crawl_consents_max_pages_valid" CHECK ("deep_crawl_consents"."max_pages" between 2 and 5),
	CONSTRAINT "deep_crawl_consents_revision_valid" CHECK ("deep_crawl_consents"."revision" > 0),
	CONSTRAINT "deep_crawl_consents_expiry_valid" CHECK ("deep_crawl_consents"."expires_at" > "deep_crawl_consents"."granted_at" and "deep_crawl_consents"."expires_at" <= "deep_crawl_consents"."granted_at" + interval '24 hours'),
	CONSTRAINT "deep_crawl_consents_path_list_valid" CHECK (jsonb_typeof("deep_crawl_consents"."allowed_path_prefixes") = 'array' and jsonb_array_length("deep_crawl_consents"."allowed_path_prefixes") between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "deep_crawl_consents" ADD CONSTRAINT "deep_crawl_consents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deep_crawl_consents" ADD CONSTRAINT "deep_crawl_consents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deep_crawl_consents" ADD CONSTRAINT "deep_crawl_consents_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deep_crawl_consents_organization_idx" ON "deep_crawl_consents" USING btree ("organization_id");