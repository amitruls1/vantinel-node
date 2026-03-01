'use client';

import { VantinelClient, VantinelConfig } from '@vantinel/js-sdk';

/**
 * Browser-side Vantinel client singleton for Next.js Client Components.
 *
 * ## Setup
 *
 * ```ts
 * // lib/vantinel.client.ts
 * 'use client';
 * import { createClientVantinel } from '@vantinel/nextjs/client';
 *
 * export const vantinel = createClientVantinel({
 *   agentId: 'browser-agent',
 *   shadowMode: process.env.NODE_ENV !== 'production', // shadow in dev/staging
 * });
 * ```
 *
 * ## Usage in Client Components
 *
 * ```tsx
 * 'use client';
 * import { vantinel } from '@/lib/vantinel.client';
 *
 * export function GenerateButton() {
 *   async function handleClick() {
 *     const traceId = vantinel.startTrace();
 *     await vantinel.track('generate_test_click', { topics }, { traceId });
 *
 *     // Pass traceId to backend for correlation
 *     await fetch('/api/generate', {
 *       headers: { 'X-Vantinel-Trace': traceId },
 *     });
 *   }
 *   return <button onClick={handleClick}>Generate</button>;
 * }
 * ```
 *
 * ## Environment Variables (browser-side — MUST use NEXT_PUBLIC_ prefix)
 * - `NEXT_PUBLIC_VANTINEL_API_KEY`       — required
 * - `NEXT_PUBLIC_VANTINEL_COLLECTOR_URL` — defaults to http://localhost:8000
 */

let _clientInstance: VantinelClient | undefined;

export function createClientVantinel(config?: VantinelConfig): VantinelClient {
  if (!_clientInstance) {
    _clientInstance = new VantinelClient({
      collectorUrl:
        process.env.NEXT_PUBLIC_VANTINEL_COLLECTOR_URL ?? 'http://localhost:8000',
      agentId: 'browser-agent',
      ...config,
      apiKey: config?.apiKey ?? process.env.NEXT_PUBLIC_VANTINEL_API_KEY,
    });
  }
  return _clientInstance;
}

export { VantinelClient };
export type { VantinelConfig };
