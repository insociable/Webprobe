# V3 scan engine foundation

The scan mode is persisted in `scans.scan_mode`. The worker resolves limits from that mode. A BullMQ job can request lower V2 browser limits but cannot raise the server caps. Public Audit remains capped at 15 pages and 20 seconds per navigation; Verified Monitoring retains its 20-page and 60-second caps.

`verified_deep_audit` is a separate, manual-only mode. It is **not executable yet**. Dispatch cancels Deep Audit jobs with `deep-engine-unavailable`, and direct worker jobs fail before any HTTP or browser operation. This keeps the new schema deployable without accidentally running the V2 crawler with broader Deep Audit permissions.

The foundation lives in `apps/worker/src/scan-engine/`:

1. `profiles.ts` defines worker-owned caps and compatible checks.
2. `authorization.ts` models an expiring, revocable DNS proof. V2's existing `verifiedAt` rule remains intact.
3. `scope-guard.ts` accepts only explicit HTTP(S) origins. Subdomains, DNS aliases, alternate ports, and redirect destinations get no implicit scope.
4. `budget-ledger.ts` atomically reserves requests, pages, bytes, DNS queries, TLS handshakes, and active-safe operations; exhaustion records a partial-coverage reason.
5. `guarded-http-transport.ts` applies authorization, scope, and budget before each DNS resolution and uses the existing pinned, SSRF-protected HTTP requester. It denies redirects outside scope.
6. `check-registry.ts`, `engine.ts`, and `evidence.ts` define versioned analysis checks over collected observations, run records, and explicit evidence classes. No V3 checks are registered yet.

Migration `0014_opposite_triton.sql` adds the mode, an authorization record, and `scan_check_runs`. Existing scan rows retain their mode and default. A guarded manual rollback is in `docs/operations/v3-migration-rollback.sql`; it refuses to remove V3 data. A rollback also requires coordinating Drizzle's migration history with the deployed application version.

Before enabling Deep Audit, connect the guarded transport to every V3 network path, add live DNS proof revalidation and revocation workflows, persist check runs and coverage, and test the full path with isolated PostgreSQL/Valkey and local HTTP fixtures. The V2 browser runtime and its public-audit protections remain unchanged in this increment.
