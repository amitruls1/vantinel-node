# @vantinel/js-sdk Changelog

## [0.3.0] - 2026-02-26

### Added
- Comprehensive Vitest test suite covering all public API methods (`src/__tests__/`)
- Integration example project (`examples/test-example/js/`) — runs 13 end-to-end tests against the built SDK to verify correctness after every change

### Changed
- README rewritten to accurately document all v0.2.0 features

## [0.2.0] - 2026-02-26

### Added
- `shadowMode` config option — when a call would be blocked, logs warning and sends Slack alert instead of blocking; perfect for "prove value before enforcing" adoption
- `slackWebhookUrl` config option — Shadow Mode sends Slack alerts: "Vantinel would have blocked `tool_name`. Estimated savings: $Y"
- `startTrace()` — generate a trace ID to correlate browser events with backend AI calls via `X-Vantinel-Trace` header
- `clientId` config option — now matches node-sdk config shape (no more divergent configs)
- `dryRun` config option — log events without sending (now matches node-sdk)
- `setGlobalMetadata()` — set `userId`, `tenantId` once; auto-included in every event
- `captureError()` — report browser-side AI errors
- Event batching: `batchSize`, `flushInterval`, `flush()` — reduce HTTP requests
- `ping()` health check — verify collector reachability from the browser
- `skip` option in `track()` — skip monitoring for specific calls

### Changed
- `track()` now returns `Promise<VantinelDecision>` (was `Promise<unknown>`)
- `args` parameter typed as `Record<string, unknown>` (was `any`)
- Hashing standardized on SHA-256 via `crypto.subtle` (was DJB2 — now consistent with node-sdk for cross-SDK correlation)

### Fixed
- Hash algorithm mismatch with node-sdk — frontend `track()` and backend `monitor()` now produce matching hashes for the same input

## [0.1.1] - 2025-11-01

### Added
- Browser SDK with `track()` method
- SHA-256 hashing via `crypto.subtle`

## [0.1.0] - 2025-10-15

### Added
- Initial release (internal)
