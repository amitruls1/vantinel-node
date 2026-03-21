# Vantinel JS/TS SDK Monorepo

Real-Time AI Agent Observability & Guardrails for JavaScript and TypeScript.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@vantinel/node-sdk`](./packages/node-sdk) | ![npm](https://img.shields.io/npm/v/@vantinel/node-sdk) | Node.js SDK — server-side agent monitoring with OpenAI/LangChain wrappers |
| [`@vantinel/js-sdk`](./packages/js-sdk) | ![npm](https://img.shields.io/npm/v/@vantinel/js-sdk) | Browser/edge SDK — lightweight client-side instrumentation |
| [`@vantinel/nextjs`](./packages/nextjs) | ![npm](https://img.shields.io/npm/v/@vantinel/nextjs) | Next.js App Router integration — server components and API route helpers |
| [`@vantinel/mcp`](./packages/mcp) | ![npm](https://img.shields.io/npm/v/@vantinel/mcp) | MCP proxy — transparent guardrails for Model Context Protocol servers |

---

## `@vantinel/node-sdk`

Full-featured server-side SDK for Node.js agents.

```bash
npm install @vantinel/node-sdk
```

### Basic Tool Monitoring

```typescript
import { VantinelMonitor } from '@vantinel/node-sdk';

const monitor = new VantinelMonitor({
  apiKey: process.env.VANTINEL_API_KEY,
  agentId: 'customer-support-bot',
  sessionBudget: 10.00,
});

// Wrap any async tool function
const search = monitor.watchTool('search_database', async (query: string) => {
  return await db.search(query);
});

const result = await search('find user by email');
```

### Zero-Config OpenAI Monitoring

```typescript
import OpenAI from 'openai';

const openai = monitor.wrapOpenAI(new OpenAI());

// All calls are now automatically tracked — cost, latency, loops
const response = await openai.chat.completions.create({ ... });
```

### LangChain Integration

```typescript
import { ChatOpenAI } from '@langchain/openai';

const llm = monitor.wrapLangChain(new ChatOpenAI());
```

### Shadow Mode (Non-Blocking Observe)

Run guardrails in observe-only mode — anomalies are logged but never blocked. Useful for baselining before enforcing policies.

```typescript
const monitor = new VantinelMonitor({
  apiKey: process.env.VANTINEL_API_KEY,
  shadowMode: true,  // observe without blocking
});
```

### Fail Mode

Control behavior if the Vantinel collector goes offline:

```typescript
const monitor = new VantinelMonitor({
  apiKey: process.env.VANTINEL_API_KEY,
  failMode: 'open',   // allow execution if collector unreachable (default)
  // failMode: 'closed', // block execution if collector unreachable (strict)
});
```

### Decision Handling

```typescript
const decision = await monitor.check('delete_records', { table: 'users' });

if (decision.action === 'REQUIRE_APPROVAL') {
  console.log('Waiting for human approval:', decision.approvalId);
} else if (decision.action === 'BLOCK') {
  throw new Error(`Blocked: ${decision.reason}`);
}
```

---

## `@vantinel/js-sdk`

Lightweight SDK for browser and edge environments (no Node.js dependencies).

```bash
npm install @vantinel/js-sdk
```

```typescript
import { VantinelClient } from '@vantinel/js-sdk';

const client = new VantinelClient({ apiKey: 'vantinel_your_key' });

await client.track({
  toolName: 'search',
  agentId: 'browser-agent',
  sessionId: 'sess_abc123',
  latencyMs: 120,
  estimatedCost: 0.002,
});
```

---

## `@vantinel/nextjs`

Next.js App Router integration with server component helpers and middleware support.

```bash
npm install @vantinel/nextjs
```

```typescript
// app/api/agent/route.ts
import { withVantinel } from '@vantinel/nextjs';

export const POST = withVantinel(async (req) => {
  // your agent handler — automatically monitored
}, {
  agentId: 'nextjs-agent',
  sessionBudget: 5.00,
});
```

See [packages/nextjs/README.md](./packages/nextjs/README.md) for full App Router integration docs.

---

## `@vantinel/mcp`

Transparent JSON-RPC proxy that sits between MCP clients and servers, applying Vantinel's full detection stack with zero changes to your server code.

```bash
npm install @vantinel/mcp
```

```typescript
import { VantinelMcpProxy } from '@vantinel/mcp';

const proxy = new VantinelMcpProxy({
  apiKey: process.env.VANTINEL_API_KEY,
  upstreamUrl: 'http://localhost:3001', // your MCP server
});

await proxy.listen(3002); // clients connect here instead
```

All `tools/call` requests are intercepted and run through zombie loop detection, budget forecasting, and anomaly detection before forwarding.

---

## Development

```bash
npm install        # Install all workspace dependencies
npm run build      # Build all packages
npm test           # Run all tests
npm run lint       # Lint all packages
```

### Publishing

Each package is published independently to npm. See [docs/SDK_PUBLISHING.md](../vantage-monorepo/docs/SDK_PUBLISHING.md) for the release process.

## License

MIT — see [LICENSE](./LICENSE)
