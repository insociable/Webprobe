ALTER TABLE "artifact_cleanup_tasks" ADD COLUMN "action" text DEFAULT 'delete' NOT NULL;--> statement-breakpoint
ALTER TABLE "artifact_cleanup_tasks" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "artifact_cleanup_tasks" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "artifact_cleanup_tasks" ADD COLUMN "scan_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ownership_token_hash" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ownership_record_name" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ownership_origin" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ownership_generation" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ownership_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ownership_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ownership_revalidated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ownership_invalidated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "artifact_cleanup_tasks_scope_idx" ON "artifact_cleanup_tasks" USING btree ("organization_id","site_id","scan_id");--> statement-breakpoint
ALTER TABLE "artifact_cleanup_tasks" ADD CONSTRAINT "artifact_cleanup_tasks_action_supported" CHECK ("artifact_cleanup_tasks"."action" in ('delete', 'write_intent'));--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_ownership_proof_complete" CHECK (("sites"."ownership_token_hash" is null and "sites"."ownership_record_name" is null and "sites"."ownership_origin" is null and "sites"."ownership_generation" is null and "sites"."ownership_verified_at" is null and "sites"."ownership_expires_at" is null and "sites"."ownership_revalidated_at" is null)
          or ("sites"."ownership_token_hash" is not null and "sites"."ownership_record_name" is not null and "sites"."ownership_origin" is not null and "sites"."ownership_generation" is not null and "sites"."ownership_verified_at" is not null and "sites"."ownership_expires_at" is not null and "sites"."ownership_revalidated_at" is not null));--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_ownership_token_hash_valid" CHECK ("sites"."ownership_token_hash" is null or "sites"."ownership_token_hash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_ownership_record_name_valid" CHECK ("sites"."ownership_record_name" is null or "sites"."ownership_record_name" ~ '^_agency-monitor[.]');--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_ownership_origin_valid" CHECK ("sites"."ownership_origin" is null or "sites"."ownership_origin" ~ '^https?://[^/?#]+$');--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_ownership_expiry_after_verification" CHECK ("sites"."ownership_expires_at" is null or ("sites"."ownership_verified_at" is not null and "sites"."ownership_expires_at" > "sites"."ownership_verified_at" and "sites"."ownership_revalidated_at" >= "sites"."ownership_verified_at"));