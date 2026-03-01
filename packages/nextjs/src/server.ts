import { VantinelMonitor, VantinelConfig } from '@vantinel/node-sdk';

/**
 * Server-side Vantinel monitor singleton for Next.js.
 *
 * Uses the `globalThis` pattern to survive hot-reload in dev mode —
 * the same instance is reused across module re-evaluations.
 *
 * ## Setup
 *
 * ```ts
 * // lib/vantinel.server.ts
 * import { createServerMonitor } from '@vantinel/nextjs/server';
 *
 * export const monitor = createServerMonitor({
 *   agentId: 'my-nextjs-app',
 *   // Reads VANTINEL_API_KEY, VANTINEL_CLIENT_ID, VANTINEL_COLLECTOR_URL from env automatically
 * });
 * ```
 *
 * ## Usage in API Routes
 *
 * ```ts
 * // app/api/generate/route.ts
 * import { monitor } from '@/lib/vantinel.server';
 *
 * export async function POST(req: Request) {
 *   const generateAnswer = monitor.monitor('gemini_generate', rawGenerateFn, {
 *     costCalculator: (result) => ({
 *       estimated_cost: (result.usageMetadata.totalTokenCount / 1000) * 0.0005,
 *       metadata: { tokens: result.usageMetadata.totalTokenCount },
 *     }),
 *   });
 *   const answer = await generateAnswer(userQuery);
 *   return Response.json({ answer });
 * }
 * ```
 *
 * ## Trace Correlation (frontend → backend)
 *
 * ```ts
 * // Frontend (browser)
 * const traceId = vantinel.startTrace();
 * fetch('/api/generate', { headers: { 'X-Vantinel-Trace': traceId } });
 *
 * // Backend (API route)
 * const traceId = req.headers.get('X-Vantinel-Trace') ?? undefined;
 * const result = await monitor.monitor('gemini_generate', fn, { traceId })(input);
 * ```
 *
 * ## Environment Variables (server-side — never expose to browser)
 * - `VANTINEL_API_KEY`         — required
 * - `VANTINEL_CLIENT_ID`       — your org/project identifier
 * - `VANTINEL_COLLECTOR_URL`   — defaults to http://localhost:8000
 * - `VANTINEL_AGENT_ID`        — defaults to 'default-agent'
 * - `VANTINEL_DRY_RUN`         — set to 'true' in CI to disable sending
 * - `VANTINEL_SHADOW_MODE`     — set to 'true' to observe without enforcing
 */

declare const globalThis: {
  __vantinelMonitor?: VantinelMonitor;
} & typeof global;

export function createServerMonitor(config?: VantinelConfig): VantinelMonitor {
  if (!globalThis.__vantinelMonitor) {
    globalThis.__vantinelMonitor = new VantinelMonitor(config ?? {});
  }
  return globalThis.__vantinelMonitor;
}

export { VantinelMonitor };
export type { VantinelConfig };
