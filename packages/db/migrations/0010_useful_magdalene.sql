CREATE TABLE "scan_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_artifacts_kind_supported" CHECK ("scan_artifacts"."kind" = 'primary-screenshot'),
	CONSTRAINT "scan_artifacts_media_type_supported" CHECK ("scan_artifacts"."media_type" = 'image/jpeg'),
	CONSTRAINT "scan_artifacts_byte_size_positive" CHECK ("scan_artifacts"."byte_size" > 0),
	CONSTRAINT "scan_artifacts_sha256_length" CHECK (length("scan_artifacts"."sha256") = 64),
	CONSTRAINT "scan_artifacts_storage_key_not_blank" CHECK (length(btrim("scan_artifacts"."storage_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "scan_artifacts" ADD CONSTRAINT "scan_artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_artifacts" ADD CONSTRAINT "scan_artifacts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_artifacts" ADD CONSTRAINT "scan_artifacts_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_artifacts_scan_kind_unique" ON "scan_artifacts" USING btree ("scan_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_artifacts_storage_key_unique" ON "scan_artifacts" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "scan_artifacts_org_site_idx" ON "scan_artifacts" USING btree ("organization_id","site_id","scan_id");