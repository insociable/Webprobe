-- Manual rollback of 0017 only after an explicit decision to relax the invariant.
-- This preserves all grant data; it only makes generation_id nullable again.
BEGIN;

ALTER TABLE deep_audit_authorizations
  ALTER COLUMN generation_id DROP NOT NULL;

COMMIT;
