# Public Audit — security model

## Scope

Public Audit is the one-shot, tenant-scoped audit mode for a public HTTP(S) site that has not yet been verified by DNS TXT. It is intentionally separate from Verified Monitoring.

The persisted scan mode is authoritative:

- `public_audit`: one-shot public observation; allowed for `pending_verification` or verified active sites.
- `verified_monitoring`: monitoring mode; requires an active site with a successful ownership verification.

The trigger (`manual` or `scheduled`) is independent from the mode. A scheduled scan is always `verified_monitoring`.

## Trust boundary and enforcement

The browser/client payload is not trusted to choose or escalate the scan mode. The mode is persisted in PostgreSQL and re-read by the dispatch and worker persistence layers before execution.

A Public Audit cannot become Verified Monitoring by changing a queue/job payload. Scheduled dispatches with a Public Audit mode are rejected.

Tenant isolation remains unchanged: creating, reading and mutating scans requires the caller to be a member of the organization that owns the site.

## Browser and network policy

Public Audit is deliberately passive:

- manual trigger only;
- server-side profile capped at 15 pages and a 20 second navigation timeout;
- HTTP browser requests limited to `GET` and `HEAD`;
- WebSocket connections are blocked;
- downloads and service workers are disabled;
- Chromium is forced through the local safe proxy;
- private, loopback, link-local and otherwise non-public targets are rejected by the SSRF controls;
- redirects are revalidated and a third-party redirect does not become a crawl origin;
- an initial canonical shift is accepted only for the same host family, including the conservative `example.com` ↔ `www.example.com` case.

## Crawl and robots.txt

Public Audit respects `robots.txt` for deep crawling. The scanner uses the `AgencyMonitor` user-agent rules when present and otherwise falls back to the wildcard group.

Disallowed URLs are recorded as unvisited coverage entries and are not navigated. If robots policy cannot be read safely, deep crawling stops rather than guessing. In both cases the crawl analyser is marked partial so reports do not imply full coverage.

## Quotas and scheduling

Public Audit is excluded from the scheduler. Rate limits and domain cooldowns are enforced server-side when the audit is created. The dispatch layer revalidates the persisted scan mode and site state before enqueueing work.

A scheduled scan with `scan_mode = public_audit` is invalid and is cancelled rather than executed.

## Reports and notifications

A Public Audit on an unverified site remains private. Public report sharing is not enabled for an unverified Public Audit.

Public Audit also does not participate in monitoring incident/recovery notifications. Baselines for Verified Monitoring are selected only from previous `verified_monitoring` scans, so an earlier Public Audit cannot create false new/resolved alerts after ownership verification.

## Transition to Verified Monitoring

DNS TXT verification updates the site from `pending_verification` to `active`; it does not rewrite historical scans. Existing Public Audits keep `scan_mode = public_audit`.

Future manual or scheduled monitoring scans use `verified_monitoring` and require the site to remain active and verified.

## Fail-closed expectations

The Public Audit path should be considered invalid if any layer disagrees about authorization, scan mode, target identity, site state, schedule state, public-network eligibility or browser policy. Such work must be rejected or cancelled rather than silently promoted to Verified Monitoring.
