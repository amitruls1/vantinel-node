# Vantinel JS/TS SDK Monorepo

Real-Time AI Agent Observability & Guardrails for JavaScript and TypeScript.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@vantinel/node-sdk`](./packages/node-sdk) | ![npm](https://img.shields.io/npm/v/@vantinel/node-sdk) | Node.js SDK for AI agent monitoring |
| [`@vantinel/js-sdk`](./packages/js-sdk) | ![npm](https://img.shields.io/npm/v/@vantinel/js-sdk) | Browser/JavaScript SDK |
| [`@vantinel/nextjs`](./packages/nextjs) | ![npm](https://img.shields.io/npm/v/@vantinel/nextjs) | Next.js App Router integration |

## Quick Start

### Node.js

```bash
npm install @vantinel/node-sdk
```

```typescript
import { VantinelMonitor } from '@vantinel/node-sdk';

const monitor = new VantinelMonitor({
  apiKey: 'vantinel_your_key',
  sessionBudget: 10.00,
});

const result = await monitor.watchTool('search_database', async () => {
  return await db.search(query);
});
```

### Next.js

```bash
npm install @vantinel/nextjs
```

See [packages/nextjs](./packages/nextjs/README.md) for App Router integration docs.

## Development

```bash
npm install        # Install all workspace dependencies
npm run build      # Build all packages
npm test           # Run all tests
```

## License

MIT — see [LICENSE](./LICENSE)
