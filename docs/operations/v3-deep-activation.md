# V3 Deep Audit activation runbook

## Current safety state

- Public Deep remains disabled: the public `verified_deep_audit` profile has no allowed checks.
- The internal worker gate requires both `WEBPROBE_RUNTIME_ENV=preproduction` and `WEBPROBE_INTERNAL_DEEP_WORKER=enabled`.
- Production must never be labelled `preproduction` to bypass this gate. A production-specific gate requires a separate reviewed code change.
- A Deep queue job is still rejected unless the database scan is manual, carries `summary.internalDeepWorker=true`, has no requester/schedule, belongs to an active verified site, and has a live DNS-backed grant.

## Production migration order

1. Verify the production Git SHA/tag and take a database backup. Keep the Deep gate absent.
2. Confirm no Deep grants/challenges/scans are expected before V3 schema rollout.
3. Apply migrations in journal order: 0014, 0015, 0016, then 0017.
4. Migration 0017 deliberately aborts if any `deep_audit_authorizations.generation_id` is NULL. Do not synthesize or random-backfill a generation ID. Investigate the row and either recreate its proof lifecycle or remove it by an explicit data decision.
5. Verify `generation_id` is NOT NULL, Drizzle migration state is current, V2 health is green, and queue/backlog are normal.
6. Deploy V3 runtime with all public Deep entry points still closed. Do not set a production Deep gate yet.

## Future internal production activation

1. Add a dedicated production-only server gate in a separate reviewed change; do not reuse the preproduction environment identity.
2. Keep the public profile closed and require the internal DB marker plus DNS authorization fences.
3. Start with one controlled site and one manual Deep job while the normal queue is idle.
4. Verify attempt token/lease, generation fence, DNS revalidation, check runs, coverage, and cleanup.
5. Disable the internal production gate immediately after the canary unless a separate GO authorizes continued operation.

## Rollback

- 0017 can be rolled back with `v3-migration-0017-rollback.sql`; this weakens only the database nullability constraint and does not discard data.
- Rolling back 0016 is more destructive and its existing rollback script refuses to proceed when challenge, generation, or lease data exists.
- Once real Deep grants/jobs exist in production, never roll back 0016 until those records have an explicit archive/migration decision.
