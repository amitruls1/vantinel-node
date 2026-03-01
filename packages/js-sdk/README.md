# @vantinel/js-sdk

Browser/JavaScript SDK for [Vantinel](https://vantinel.ai) — real-time AI agent observability & guardrails.

## Installation

```bash
npm install @vantinel/js-sdk
# or
yarn add @vantinel/js-sdk
# or
pnpm add @vantinel/js-sdk
```

## Quick Start

```ts
import { VantinelClient } from '@vantinel/js-sdk';

const vantinel = new VantinelClient({
  apiKey: 'your-api-key',
  agentId: 'my-agent',
});

// Wrap any tool call
const result = await vantinel.track('search_database', { query: 'hello' });

if (result.decision === 'block') {
  console.warn('Tool call blocked by Vantinel policy');
}
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | — | Your Vantinel API key |
| `agentId` | `string` | `'browser-agent'` | Identifier for this agent |
| `collectorUrl` | `string` | `http://localhost:8000` | Vantinel Collector endpoint |

```ts
const vantinel = new VantinelClient({
  apiKey: 'vantinel_abc123',
  agentId: 'customer-support-bot',
  collectorUrl: 'https://collector.yourcompany.com',
});
```

> **Note:** `collectorUrl` must use HTTPS for non-localhost URLs. The SDK will throw at construction time if this is violated.

## API

### `vantinel.track(toolName, args)`

Sends a telemetry event to the Vantinel Collector and returns an enforcement decision.

```ts
const result = await vantinel.track('send_email', { to: 'user@example.com' });
// result.decision: 'allow' | 'block' | 'require_approval' | 'warn'
```

**What is sent to the Collector:**

- Tool name
- A hash of the arguments (never the raw values)
- Session ID (auto-generated UUID per client instance)
- Agent ID
- Timestamp

No user data, query content, or tool results ever leave the client.

### Exported Utilities

```ts
import { validateCollectorUrl, redactApiKey } from '@vantinel/js-sdk';

// Throws if URL is not HTTPS (unless localhost)
validateCollectorUrl('https://collector.example.com');

// Safe for logging — shows first/last 4 chars only
redactApiKey('vantinel_abc123xyz'); // → 'vant****exyz'
```

## Framework Examples

### Next.js / React

```ts
// lib/vantinel.ts
import { VantinelClient } from '@vantinel/js-sdk';

export const vantinel = new VantinelClient({
  apiKey: process.env.NEXT_PUBLIC_VANTINEL_API_KEY,
  agentId: 'nextjs-agent',
  collectorUrl: process.env.NEXT_PUBLIC_COLLECTOR_URL,
});
```

```tsx
// components/AgentButton.tsx
import { vantinel } from '@/lib/vantinel';

async function runTool() {
  const result = await vantinel.track('fetch_data', { source: 'api' });
  if (result.decision !== 'block') {
    // proceed with tool
  }
}
```

### Vanilla JS

```html
<script type="module">
  import { VantinelClient } from 'https://esm.sh/@vantinel/js-sdk';

  const vantinel = new VantinelClient({ apiKey: 'your-key' });
  await vantinel.track('my_tool', { input: 'value' });
</script>
```

## Security

- All requests are signed with **HMAC-SHA256** using the Web Crypto API
- Each request includes a timestamp and random nonce to prevent replay attacks
- API keys are never sent in plaintext headers — only a redacted identifier is included
- No sourcemaps are included in the published package

## License

MIT © Vantinel AI
