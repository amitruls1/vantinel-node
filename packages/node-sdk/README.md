# @vantinel/node-sdk

Node.js / Server-side SDK for [Vantinel](https://vantinel.ai) — real-time AI agent observability & guardrails.

## Installation

```bash
npm install @vantinel/node-sdk
# or
yarn add @vantinel/node-sdk
# or
pnpm add @vantinel/node-sdk
```

## Quick Start

```ts
import { VantinelMonitor } from '@vantinel/node-sdk';

const monitor = new VantinelMonitor({
  apiKey: process.env.VANTINEL_API_KEY,
  clientId: 'my-company',
  agentId: 'customer-support-bot',
});

// Wrap any tool function — one line
const search = monitor.monitor('search_database', async (query: string) => {
  return db.query(query);
});

// Use as normal — monitoring is transparent
const results = await search('SELECT * FROM users');
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | `$VANTINEL_API_KEY` | Your Vantinel API key |
| `clientId` | `string` | `$VANTINEL_CLIENT_ID` | Your organization ID |
| `agentId` | `string` | `'default-agent'` | Identifier for this agent |
| `collectorUrl` | `string` | `http://localhost:8000` | Vantinel Collector endpoint |
| `dryRun` | `boolean` | `false` | Log events without sending (useful in CI) |
| `shadowMode` | `boolean` | `false` | Detect threats but never block; log what *would* have happened |
| `batchSize` | `number` | `1` | Buffer N events before sending (reduces HTTP overhead) |
| `flushInterval` | `number` | `0` | Auto-flush interval in milliseconds (0 = disabled) |
| `retry.maxRetries` | `number` | `0` | Retry on 5xx/network errors |
| `retry.backoffMs` | `number` | `100` | Base backoff between retries |
| `slackWebhookUrl` | `string` | — | Shadow Mode Slack alerts webhook |

All options also read from environment variables (`VANTINEL_API_KEY`, `VANTINEL_CLIENT_ID`, `VANTINEL_DRY_RUN`, `VANTINEL_SHADOW_MODE`, etc.).

## API

### `monitor.monitor(toolName, fn, options?)`

Wraps a function for monitoring. Returns the same function, transparently instrumented.

```ts
const wrappedFn = monitor.monitor('send_email', sendEmail, {
  traceId: monitor.startTrace(),   // correlate with browser events
  skip: false,                      // set true to skip monitoring for this call
  costCalculator: (result) => ({    // extract cost from AI API response
    estimated_cost: result.usage.total_tokens * 0.00001,
    metadata: { model: 'gpt-4', tokens: result.usage.total_tokens },
  }),
});
```

**Decisions:** If the Collector returns `block`, an error is thrown. All other decisions allow execution.

### `monitor.wrapOpenAI(openaiClient)`

Zero-config monitoring for all OpenAI chat completions:

```ts
import OpenAI from 'openai';

const openai = monitor.wrapOpenAI(new OpenAI());
// All openai.chat.completions.create() calls are now monitored
const response = await openai.chat.completions.create({ model: 'gpt-4', messages: [...] });
```

### `monitor.wrapLangChain(chain)`

Zero-config monitoring for LangChain chains (invoke, call, run, stream):

```ts
const chain = prompt.pipe(llm).pipe(parser);
const monitored = monitor.wrapLangChain(chain);
const result = await monitored.invoke({ question: 'What is 2+2?' });
```

### `monitor.captureError(toolName, error, metadata?)`

Report a tool failure to the Collector:

```ts
try {
  await myTool();
} catch (err) {
  await monitor.captureError('my_tool', err, { retry: 1, context: 'user-flow' });
  throw err;
}
```

### `monitor.setGlobalMetadata(metadata)`

Attach key-value metadata to every subsequent event (merge, not replace):

```ts
monitor.setGlobalMetadata({ userId: 'user_123', tenantId: 'acme-corp' });
monitor.setGlobalMetadata({ environment: 'production' }); // merged
```

### `monitor.startTrace()`

Generate a UUID trace ID to correlate frontend and backend events:

```ts
const traceId = monitor.startTrace();
// Pass traceId to browser SDK via X-Vantinel-Trace header
const fn = monitor.monitor('backend_call', myFn, { traceId });
```

### `monitor.ping()`

Check connectivity to the Collector:

```ts
const { ok, latencyMs } = await monitor.ping();
if (!ok) console.warn('Collector unreachable');
```

### `monitor.flush()`

Drain the event batch queue immediately (useful on graceful shutdown):

```ts
process.on('SIGTERM', async () => {
  await monitor.flush();
  process.exit(0);
});
```

### `VantinelMonitor.getSingleton(config?)`

Return a shared instance — safe for Next.js hot-reload and multi-import scenarios:

```ts
// lib/vantinel.ts
export const monitor = VantinelMonitor.getSingleton({
  apiKey: process.env.VANTINEL_API_KEY,
});
```

## Shadow Mode

Shadow Mode observes without enforcing — ideal for proving value before enabling hard blocks:

```ts
const monitor = new VantinelMonitor({
  shadowMode: true,
  slackWebhookUrl: process.env.SLACK_WEBHOOK, // optional
});
// Blocked calls are allowed but logged: "[Vantinel Shadow] Would have blocked `delete_users`"
```

## Enforcement Decisions

| Decision | Behavior |
|---|---|
| `allow` | Tool executes normally |
| `block` | SDK throws `Error: [Vantinel] Tool blocked: ...` |
| `require_approval` | Warning logged, execution continues (approval UI in dashboard) |
| `warn` | Tool executes, warning logged |

If the Collector is unreachable, the SDK **fails open** — the tool executes normally. Collector downtime never breaks your agent.

## Security

- All requests signed with **HMAC-SHA256** (`timestamp.body` format)
- Per-request nonces prevent replay attacks
- Tool arguments are **never sent** — only a SHA-256 hash
- **Fail-open by default**: any network/5xx error returns `{ decision: 'allow' }`

## License

MIT © Vantinel AI
