DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "deep_audit_authorizations"
		WHERE "generation_id" IS NULL
	) THEN
		RAISE EXCEPTION 'deep_audit_authorizations.generation_id contains NULL; refuse NOT NULL migration without an explicit data decision';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "deep_audit_authorizations" ALTER COLUMN "generation_id" SET NOT NULL;
