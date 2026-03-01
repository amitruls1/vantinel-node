# @vantinel/nextjs Changelog

## [0.2.0] - 2026-02-26

### Added
- `README.md` — setup guide covering VantinelProvider, useVantinel(), createServerMonitor(), createClientVantinel(), trace correlation, and environment variable reference

### Changed
- Peer dependency on `@vantinel/node-sdk` and `@vantinel/js-sdk` bumped to `^0.3.0`

## [0.1.0] - 2026-02-26

### Added
- `VantinelProvider` — React context provider for Next.js App Router; wraps your root layout to enable `useVantinel()` everywhere
- `useVantinel()` — hook giving client components access to `track()`, `captureError()`, `ping()`, `startTrace()`, `setGlobalMetadata()`, `flush()`
- `createServerMonitor()` — `globalThis` singleton factory for API routes and Server Components (survives Next.js hot-reload; no duplicate instances)
- `createClientVantinel()` — module-level singleton for Client Components (without the Provider pattern)
- Full TypeScript support with typed exports
- Environment variable guidance:
  - Server: `VANTINEL_API_KEY`, `VANTINEL_CLIENT_ID`, `VANTINEL_COLLECTOR_URL`, `VANTINEL_DRY_RUN`, `VANTINEL_SHADOW_MODE`
  - Browser: `NEXT_PUBLIC_VANTINEL_API_KEY`, `NEXT_PUBLIC_VANTINEL_COLLECTOR_URL`
- Trace correlation pattern: `startTrace()` on browser → pass via `X-Vantinel-Trace` header → backend `monitor(fn, { traceId })`
