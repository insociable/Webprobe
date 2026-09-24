-- Manual rollback for migration 0015 only, after reverting code that reads these columns.
-- It refuses to discard durable DNS proof material or check evidence.
-- Coordinate Drizzle migration history separately; never run this as an automatic down migration.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM deep_audit_authorizations
    WHERE proof_record_name IS NOT NULL OR proof_token_hash IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM scan_check_runs WHERE evidence <> '[]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Migration 0015 data exists; archive or migrate it before rollback';
  END IF;
END $$;

ALTER TABLE deep_audit_authorizations DROP CONSTRAINT deep_audit_proof_hash_valid;
ALTER TABLE deep_audit_authorizations DROP COLUMN proof_record_name;
ALTER TABLE deep_audit_authorizations DROP COLUMN proof_token_hash;
ALTER TABLE scan_check_runs DROP COLUMN evidence;

COMMIT;
