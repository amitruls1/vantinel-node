'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { VantinelClient, VantinelConfig, VantinelDecision } from '@vantinel/js-sdk';

interface VantinelContextValue {
  client: VantinelClient;
  track: (
    toolName: string,
    args: Record<string, unknown>,
    options?: { traceId?: string; skip?: boolean },
  ) => Promise<VantinelDecision>;
  captureError: (
    toolName: string,
    error: Error,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  ping: () => Promise<{ ok: boolean; latencyMs: number }>;
  startTrace: () => string;
  setGlobalMetadata: (metadata: Record<string, unknown>) => void;
  flush: () => Promise<void>;
}

const VantinelContext = createContext<VantinelContextValue | null>(null);

export interface VantinelProviderProps {
  config: VantinelConfig;
  children: ReactNode;
}

/**
 * VantinelProvider — Add to your root layout to enable `useVantinel()` in any client component.
 *
 * ## Setup (app/layout.tsx)
 *
 * ```tsx
 * import { VantinelProvider } from '@vantinel/nextjs';
 *
 * export default function RootLayout({ children }: { children: React.ReactNode }) {
 *   return (
 *     <html>
 *       <body>
 *         <VantinelProvider config={{
 *           apiKey: process.env.NEXT_PUBLIC_VANTINEL_API_KEY,
 *           agentId: 'my-app',
 *           shadowMode: process.env.NODE_ENV !== 'production',
 *           slackWebhookUrl: process.env.NEXT_PUBLIC_VANTINEL_SLACK_WEBHOOK,
 *         }}>
 *           {children}
 *         </VantinelProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function VantinelProvider({ config, children }: VantinelProviderProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const client = useMemo(() => new VantinelClient(config), []);

  const value = useMemo<VantinelContextValue>(
    () => ({
      client,
      track: client.track.bind(client),
      captureError: client.captureError.bind(client),
      ping: client.ping.bind(client),
      startTrace: client.startTrace.bind(client),
      setGlobalMetadata: client.setGlobalMetadata.bind(client),
      flush: client.flush.bind(client),
    }),
    [client],
  );

  return (
    <VantinelContext.Provider value={value}>
      {children}
    </VantinelContext.Provider>
  );
}

/**
 * useVantinel — access Vantinel tracking in any client component.
 *
 * Must be used inside `<VantinelProvider>`.
 *
 * ```tsx
 * 'use client';
 * import { useVantinel } from '@vantinel/nextjs';
 *
 * export function GenerateButton({ topics }: { topics: string[] }) {
 *   const { track, captureError, startTrace } = useVantinel();
 *
 *   async function handleClick() {
 *     const traceId = startTrace();
 *     try {
 *       await track('generate_test_click', { topics }, { traceId });
 *       await fetch('/api/generate', {
 *         headers: { 'X-Vantinel-Trace': traceId },
 *       });
 *     } catch (err) {
 *       await captureError('generate_test_click', err as Error);
 *     }
 *   }
 *
 *   return <button onClick={handleClick}>Generate Test</button>;
 * }
 * ```
 */
export function useVantinel(): VantinelContextValue {
  const ctx = useContext(VantinelContext);
  if (!ctx) {
    throw new Error('[Vantinel] useVantinel() must be used inside <VantinelProvider>');
  }
  return ctx;
}

export { VantinelClient };
export type { VantinelConfig, VantinelContextValue, VantinelDecision };

// NOTE: Server utilities (createServerMonitor) are available via '@vantinel/nextjs/server'.
// They are NOT re-exported here because this file is marked 'use client' and
// server code (Node.js SDK) cannot be bundled in the client bundle.
// Client utilities (createClientVantinel) are available via '@vantinel/nextjs/client'.
export { createClientVantinel } from './client';
