# @vantinel/nextjs

Next.js App Router integration for [Vantinel](https://vantinel.ai) — real-time AI agent observability & guardrails.

This package provides first-class Next.js support on top of the `@vantinel/node-sdk` (server) and `@vantinel/js-sdk` (browser), with React context, hooks, and a singleton factory that survives hot-reload.

## Installation

```bash
npm install @vantinel/nextjs
```

## Quick Start

### 1. Add environment variables

```bash
# .env.local
VANTINEL_API_KEY=vantinel_abc123
VANTINEL_CLIENT_ID=my-company

# Exposed to the browser
NEXT_PUBLIC_VANTINEL_API_KEY=vantinel_abc123
NEXT_PUBLIC_VANTINEL_COLLECTOR_URL=https://collector.yourcompany.com
```

### 2. Wrap your root layout

```tsx
// app/layout.tsx
import { VantinelProvider } from '@vantinel/nextjs';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <VantinelProvider
          apiKey={process.env.NEXT_PUBLIC_VANTINEL_API_KEY!}
          collectorUrl={process.env.NEXT_PUBLIC_VANTINEL_COLLECTOR_URL}
        >
          {children}
        </VantinelProvider>
      </body>
    </html>
  );
}
```

### 3. Monitor tools in Client Components

```tsx
'use client';
import { useVantinel } from '@vantinel/nextjs/client';

export default function AgentPage() {
  const { track, captureError } = useVantinel();

  async function runSearch(query: string) {
    const decision = await track('search_database', { query });
    if (decision.decision === 'block') return;

    try {
      return await fetch('/api/search', { body: JSON.stringify({ query }) });
    } catch (err) {
      await captureError('search_database', err as Error);
    }
  }
}
```

### 4. Monitor tools in Server Components & API Routes

```ts
// app/api/agent/route.ts
import { createServerMonitor } from '@vantinel/nextjs/server';

const monitor = createServerMonitor({
  apiKey: process.env.VANTINEL_API_KEY!,
  clientId: process.env.VANTINEL_CLIENT_ID!,
});

export async function POST(req: Request) {
  const wrappedSearch = monitor.monitor('search_database', searchDatabase);
  const results = await wrappedSearch({ query: 'hello' });
  return Response.json(results);
}
```

## API

### `<VantinelProvider>`

React context provider. Place in your root `app/layout.tsx`.

```tsx
import { VantinelProvider } from '@vantinel/nextjs';

<VantinelProvider
  apiKey="your-key"
  collectorUrl="https://collector.yourcompany.com"  // optional
  agentId="my-next-app"                             // optional
  dryRun={process.env.NODE_ENV !== 'production'}    // optional
  shadowMode={false}                                // optional
>
  {children}
</VantinelProvider>
```

### `useVantinel()` — Client Components

Access the Vantinel client from any Client Component:

```ts
import { useVantinel } from '@vantinel/nextjs/client';

const {
  track,             // (toolName, args) => Promise<VantinelDecision>
  captureError,      // (toolName, error, metadata?) => Promise<void>
  ping,              // () => Promise<{ ok: boolean; latencyMs: number }>
  startTrace,        // () => string (UUID)
  setGlobalMetadata, // (metadata) => void
  flush,             // () => Promise<void>
} = useVantinel();
```

### `createServerMonitor(config)` — Server Components & API Routes

Returns a `VantinelMonitor` singleton that persists across hot-reloads:

```ts
import { createServerMonitor } from '@vantinel/nextjs/server';

const monitor = createServerMonitor({
  apiKey: process.env.VANTINEL_API_KEY!,
  clientId: process.env.VANTINEL_CLIENT_ID!,
  agentId: 'api-route-agent',
  dryRun: process.env.VANTINEL_DRY_RUN === 'true',
});

// All VantinelMonitor methods available:
// monitor.monitor(), monitor.wrapOpenAI(), monitor.wrapLangChain()
// monitor.captureError(), monitor.ping(), monitor.flush(), etc.
```

### `createClientVantinel(config)` — without Provider

Module-level singleton for Client Components that don't use the Provider pattern:

```ts
import { createClientVantinel } from '@vantinel/nextjs/client';

const vantinel = createClientVantinel({
  apiKey: process.env.NEXT_PUBLIC_VANTINEL_API_KEY!,
});
```

## Trace Correlation

Link browser events to server-side AI calls with a shared trace ID:

```tsx
// Client Component
const { track, startTrace } = useVantinel();
const traceId = startTrace();

// Pass trace ID to your API route
await fetch('/api/agent', {
  headers: { 'X-Vantinel-Trace': traceId },
  body: JSON.stringify({ query }),
});
```

```ts
// API Route
const monitor = createServerMonitor({ ... });

export async function POST(req: Request) {
  const traceId = req.headers.get('X-Vantinel-Trace') ?? undefined;
  const wrappedFn = monitor.monitor('openai_call', callOpenAI, { traceId });
  return Response.json(await wrappedFn());
}
```

## Environment Variables

### Server-side (API routes, Server Components)

| Variable | Required | Description |
|---|---|---|
| `VANTINEL_API_KEY` | Yes | API key |
| `VANTINEL_CLIENT_ID` | Yes | Organization ID |
| `VANTINEL_COLLECTOR_URL` | No | Defaults to `http://localhost:8000` |
| `VANTINEL_DRY_RUN` | No | Set `true` to disable HTTP in CI |
| `VANTINEL_SHADOW_MODE` | No | Set `true` for shadow mode |

### Browser-side (Client Components)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_VANTINEL_API_KEY` | Yes | API key (exposed to browser) |
| `NEXT_PUBLIC_VANTINEL_COLLECTOR_URL` | No | Collector URL (must be HTTPS for non-localhost) |

## License

MIT © Vantinel AI
