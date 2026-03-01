# @vantinel/node-sdk Changelog

## [0.3.0] - 2026-02-26

### Added
- Comprehensive Jest test suite covering security utilities, VantinelClient, and VantinelMonitor (`src/__tests__/`)
- Integration example project (`examples/test-example/node/`) — 15 end-to-end tests covering CRUD workflow, upsert, wrapOpenAI, wrapLangChain, shadowMode, and more

### Changed
- README rewritten to document all v0.2.0 features (shadowMode, wrapLangChain, getSingleton, costCalculator, captureError, batching, etc.)

## [0.2.0] - 2026-02-26

### Added
- `startTrace()` — generate a trace ID to correlate browser events with backend AI calls
- `wrapLangChain(chain)` — wrap any LangChain chain (`invoke`, `call`, `run`, `stream`) in one line for zero-config monitoring
- `slackWebhookUrl` config option — Shadow Mode now sends Slack alerts: "Vantinel would have blocked `tool_name` (Policy Violation). Estimated savings: $14.20"
- `setGlobalMetadata()` — set `userId`, `tenantId`, `userRole` once; auto-included in every event
- `getSingleton()` static factory — prevents duplicate instances in Next.js hot-reload environments
- `captureError()` — report tool errors with error type, stack, and retry context
- `costCalculator` option in `monitor()` — extract and report per-call cost from AI API response
- Event batching: `batchSize`, `flushInterval`, `flush()` — reduce HTTP overhead in RAG pipelines
- `ping()` health check — verify collector connectivity at startup
- `retry` config option — configurable retry on 5xx with exponential backoff
- `skip` option in `monitor()` — skip monitoring for health checks or test data
- `VANTINEL_DRY_RUN` env var — enable dry run mode in CI without code changes
- `VANTINEL_SHADOW_MODE` env var — enable shadow mode via environment

### Changed
- `sendEvent()` now returns `Promise<VantinelDecision>` (was `Promise<any>`)
- Hashing standardized on SHA-256 (was MD5)
- `prepublishOnly` now builds without obfuscation — stack traces and debugging work correctly
- `monitor()` sends a follow-up `tool_result` event with `latency_ms` after function completes
- Shadow Mode log now includes session ID and reason (Policy Violation / Approval Required)

### Fixed
- `--disable-console-output` obfuscator flag removed — dryRun log messages now appear correctly
- Removed `javascript-obfuscator` from `prepublishOnly` — enterprise customers can now audit source

## [0.1.2] - 2025-11-15

### Fixed
- Minor type fixes for VantinelEvent
- Improved error handling in sendEvent()

## [0.1.1] - 2025-10-28

### Added
- Initial dryRun support
- Basic retry logic

## [0.1.0] - 2025-10-01

### Added
- Initial release
- VantinelMonitor class with `monitor()` and `sendEvent()`
- OpenAI wrapper (`wrapOpenAI`)
