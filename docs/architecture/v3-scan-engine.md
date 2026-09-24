# V3 scan engine foundation

The scan mode is persisted in `scans.scan_mode`. The worker resolves limits from that mode. A BullMQ job can request lower V2 browser limits but cannot raise the server caps. Public Audit remains capped at 15 pages and 20 seconds per navigation; Verified Monitoring retains its 20-page and 60-second caps.

`verified_deep_audit` is a separate, manual-only mode. It is **not executable yet**. Dispatch cancels Deep Audit jobs with `deep-engine-unavailable`, and direct worker jobs fail before any HTTP or browser operation. This keeps the new schema deployable without accidentally running the V2 crawler with broader Deep Audit permissions.

The foundation lives in `apps/worker/src/scan-engine/`:

1. `profiles.ts` defines worker-owned caps and compatible checks.
2. `authorization.ts` models an expiring, revocable DNS proof. V2's existing `verifiedAt` rule remains intact.
3. `scope-guard.ts` accepts only explicit HTTP(S) origins. Subdomains, DNS aliases, alternate ports, and redirect destinations get no implicit scope.
4. `budget-ledger.ts` atomically reserves requests, pages, bytes, DNS queries, TLS handshakes, and active-safe operations; exhaustion records a partial-coverage reason.
5. `guarded-http-transport.ts` applies authorization, scope, and budget before each DNS resolution and uses the existing pinned, SSRF-protected HTTP requester. It denies redirects outside scope.
6. `guarded-browser-transport.ts` routes V3 Chromium requests through browser interception and the pinned local proxy. The browser guard checks each navigation, redirect, frame, fetch/XHR, and subresource request; the proxy independently checks scope before DNS and pins a public address. The proxy debits the same byte ledger. WebSockets are closed and service workers are blocked.
7. `check-registry.ts`, `engine.ts`, `evidence.ts`, and `deep-checks.ts` define two passive, versioned observation checks. They receive observations, not a network client. The production Deep Audit profile still lists no allowed checks.
8. `check-persistence.ts` writes runs, evidence, and coverage atomically for a running Deep scan. It refuses duplicate attempts rather than overwriting history.
9. `deep-proof.ts` validates the persisted TXT name and token hash against the site's canonical host, checks DNS with a timeout, and conditionally refreshes `revalidated_at`. Invalid or ambiguous results deny authorization. The ordinary connection-time SSRF and scope checks still apply.
10. `deep-candidate.ts` ties DB ownership, DNS revalidation, guarded HTTP/browser collection, check analysis, and transactional persistence together. If collection stops, the affected check is saved as skipped with the transport reason. The default Deep profile still prevents collection because its allowed-check list is empty; an internally supplied test profile is validated against server caps.

Migration `0014_opposite_triton.sql` adds the mode, an authorization record, and `scan_check_runs`. Migration `0015_nervous_madame_hydra.sql` adds nullable proof metadata and an evidence array with an empty default. Existing rows remain valid in storage, but grants lacking durable proof metadata cannot authorize Deep Audit. Guarded manual rollback scripts are in `docs/operations/`; they refuse to discard V3 data. A rollback also requires coordinating Drizzle's migration history with the deployed application version.

Deep Audit is still rejected by dispatch, scan-context validation, and the worker processor. Before enabling it, connect the candidate lifecycle to production job claiming and cancellation, add grant issuance and revocation workflows, verify browser interception against a real Chromium instance, and run the new migration and PostgreSQL integration tests on Linux. Concurrent candidate attempts are prevented from double-writing, but a production claim/lease is still needed to prevent duplicate network collection. Active-safe checks have no network facade yet and remain unavailable. V2 keeps its existing route and proxy behavior.

The shared `bytesTransferred` ledger has one owner per transport: the guarded HTTP probe counts socket bytes read and written up to response headers or failure (it intentionally stops without downloading the body); the V3 browser proxy counts HTTP request/response header octets and forwarded response body chunks, or encrypted CONNECT tunnel bytes in both directions. HTTPS requests multiplexed inside a tunnel are counted once at the browser route for the request budget and once at the proxy for bytes. A rejected chunk is not forwarded. The current model does not yet cover future active-safe collectors, which must use a guarded transport before activation.
