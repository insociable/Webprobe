-- Manual rollback for migration 0014 only. Never run while V3 application code is active.
-- The guards prevent loss of Deep Audit scans, authorizations, or check runs.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM scans WHERE scan_mode = 'verified_deep_audit')
     OR EXISTS (SELECT 1 FROM deep_audit_authorizations)
     OR EXISTS (SELECT 1 FROM scan_check_runs) THEN
    RAISE EXCEPTION 'V3 data exists; archive or migrate it before rollback';
  END IF;
END $$;

DROP TABLE scan_check_runs;
DROP TABLE deep_audit_authorizations;
ALTER TABLE scans DROP CONSTRAINT scans_mode_trigger_consistent;
ALTER TABLE scans ALTER COLUMN scan_mode DROP DEFAULT;
ALTER TYPE scan_mode RENAME TO scan_mode_v3;
CREATE TYPE scan_mode AS ENUM ('public_audit', 'verified_monitoring');
ALTER TABLE scans ALTER COLUMN scan_mode TYPE scan_mode
  USING scan_mode::text::scan_mode;
ALTER TABLE scans ALTER COLUMN scan_mode SET DEFAULT 'verified_monitoring';
ALTER TABLE scans ADD CONSTRAINT scans_mode_trigger_consistent
  CHECK (scan_mode = 'verified_monitoring' OR trigger = 'manual');
DROP TYPE scan_mode_v3;

COMMIT;
