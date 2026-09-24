-- Manual rollback of 0016 only after reverting code that reads these fields.
-- Refuses to discard challenges, grant generations or execution lease history.
-- Coordinate the Drizzle migration journal separately. Never run automatically.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM deep_audit_challenges)
    OR EXISTS (
      SELECT 1 FROM deep_audit_authorizations
      WHERE generation_id IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM scan_attempts
      WHERE lease_token IS NOT NULL OR lease_until IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'Migration 0016 data exists; archive or migrate it before rollback';
  END IF;
END $$;

DROP TABLE deep_audit_challenges;
ALTER TABLE deep_audit_authorizations DROP COLUMN generation_id;
ALTER TABLE scan_attempts DROP COLUMN lease_until;
ALTER TABLE scan_attempts DROP COLUMN lease_token;

COMMIT;
