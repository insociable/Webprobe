ALTER TABLE "deep_audit_authorizations" ADD COLUMN "proof_record_name" text;--> statement-breakpoint
ALTER TABLE "deep_audit_authorizations" ADD COLUMN "proof_token_hash" text;--> statement-breakpoint
ALTER TABLE "scan_check_runs" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deep_audit_authorizations" ADD CONSTRAINT "deep_audit_proof_hash_valid" CHECK ("deep_audit_authorizations"."proof_token_hash" is null or "deep_audit_authorizations"."proof_token_hash" ~ '^[a-f0-9]{64}$');