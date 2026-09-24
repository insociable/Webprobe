# Health and diagnostics

Phase 4B keeps public health information deliberately small.

## Public endpoints

- `GET /api/health/live`: process liveness only. It does not query dependencies.
- `GET /api/health/ready`: readiness for PostgreSQL, Valkey, worker heartbeat, scan queue and browser.
- `GET /api/health`: compatibility alias for readiness.

Readiness returns only component states and HTTP 503 when any required component is down.
It does not expose queue sizes, scan counts, URLs, tenant identifiers or error details.

## Worker heartbeat

The scanner worker publishes an expiring health snapshot to Valkey every 10 seconds.
A missing or stale heartbeat makes readiness fail closed.

The snapshot includes operational metrics only:

- BullMQ waiting, active, delayed, failed, backlog and oldest pending age;
- running and stale scans;
- separate Deep running/stale and 24-hour completed/failed counters, so Deep incidents are distinguishable from V2;
- completed and failed scans over the last 24 hours;
- recent success rate and average terminal duration;
- pending/error scan dispatches;
- database, queue and browser state.

Chromium is probed periodically by launching and closing a headless browser without navigation.

## Local detailed diagnostics

Detailed metrics are intentionally not exposed through a public HTTP route.

From the project directory, run:

```bash
pnpm --filter @agency-saas/worker diagnostics
```

The command reads the current Valkey heartbeat and reports its age/freshness.
