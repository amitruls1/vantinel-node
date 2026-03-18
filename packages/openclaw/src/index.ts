/**
 * @vantinel/openclaw
 *
 * One-line setup for Vantinel observability with OpenClaw / NemoClaw agents.
 *
 * @example
 * import { setup } from '@vantinel/openclaw'
 * await setup({ apiKey: 'vntl_...', gatewayUrl: 'http://localhost:8000' })
 */

export { getOpenclawConfigPath, readOpenclawConfig, writeOpenclawConfig, buildVantinelConfigFragment } from './config.js';
export { startMcpProxy, stopMcpProxy, isMcpProxyRunning } from './proxy.js';
export type { OpenclawSetupConfig, SetupResult, OpenclawClientWrapper } from './types.js';

import { buildVantinelConfigFragment, writeOpenclawConfig } from './config.js';
import type { OpenclawSetupConfig, SetupResult } from './types.js';

/**
 * One-call setup: writes openclaw.json fragment, verifies gateway connectivity,
 * and optionally starts the MCP proxy.
 */
export async function setup(config: OpenclawSetupConfig): Promise<SetupResult> {
  const gatewayUrl = (config.gatewayUrl ?? 'http://localhost:8000').replace(/\/$/, '');
  const errors: string[] = [];
  let gatewayLatencyMs: number | undefined;
  let configWritten = false;
  let configPath = '';
  let proxyStarted = false;

  // 1. Write openclaw.json fragment
  try {
    const fragment = buildVantinelConfigFragment(config.apiKey, gatewayUrl);
    configPath = writeOpenclawConfig(fragment);
    configWritten = true;
  } catch (err) {
    errors.push(`Failed to write openclaw.json: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Verify gateway connectivity
  try {
    const start = Date.now();
    const res = await fetch(`${gatewayUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    gatewayLatencyMs = Date.now() - start;
    if (!res.ok) {
      errors.push(`Gateway health check failed: HTTP ${res.status}`);
    }
  } catch (err) {
    errors.push(`Cannot reach gateway at ${gatewayUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Optionally start MCP proxy
  if (config.startMcpProxy) {
    try {
      const { startMcpProxy } = await import('./proxy.js');
      proxyStarted = await startMcpProxy('openclaw-mcp-server', [], {
        mode: config.proxyMode ?? 'openclaw',
        collectorUrl: gatewayUrl,
        apiKey: config.apiKey,
      });
    } catch (err) {
      errors.push(`Failed to start MCP proxy: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    ok: errors.length === 0,
    gatewayUrl,
    gatewayLatencyMs,
    configWritten,
    configPath,
    proxyStarted,
    errors,
  };
}

/**
 * Programmatically wrap an OpenClaw JS client instance.
 * Intercepts tool calls to add Vantinel observability.
 *
 * @param client - An OpenClaw client instance (duck-typed)
 * @param config - Vantinel config
 */
export function wrapOpenClaw(
  client: Record<string, unknown>,
  config: Pick<OpenclawSetupConfig, 'apiKey' | 'gatewayUrl' | 'agentId'>
): Record<string, unknown> {
  const gatewayUrl = (config.gatewayUrl ?? 'http://localhost:8000').replace(/\/$/, '');
  const apiKey = config.apiKey;

  // Wrap the `run` method if it exists (OpenClaw's main execution method)
  if (typeof client['run'] === 'function') {
    const originalRun = client['run'] as (...args: unknown[]) => Promise<unknown>;
    const agentId = config.agentId ?? 'openclaw-agent';
    const sessionId = `oc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Send session start
    void sendSessionEvent(apiKey, gatewayUrl, 'start', sessionId, agentId).catch(() => {});

    client['run'] = async function (...args: unknown[]) {
      try {
        const result = await originalRun.apply(client, args);
        void sendSessionEvent(apiKey, gatewayUrl, 'end', sessionId, agentId).catch(() => {});
        return result;
      } catch (err) {
        void sendSessionEvent(apiKey, gatewayUrl, 'error', sessionId, agentId, {
          error: err instanceof Error ? err.message : String(err),
        }).catch(() => {});
        throw err;
      }
    };
  }

  return client;
}

/**
 * Returns the Vantinel dashboard deep-link URL for a given agent session.
 */
export function getSessionUrl(
  sessionId: string,
  options?: { dashboardUrl?: string }
): string {
  const base = (options?.dashboardUrl ?? 'https://app.vantinel.com').replace(/\/$/, '');
  return `${base}/agents/${encodeURIComponent(sessionId)}`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function sendSessionEvent(
  apiKey: string,
  gatewayUrl: string,
  event: 'start' | 'end' | 'step' | 'error',
  sessionId: string,
  agentId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await fetch(`${gatewayUrl}/v1/agents/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Vantinel-API-Key': apiKey,
    },
    body: JSON.stringify({ event, session_id: sessionId, agent_id: agentId, metadata }),
    signal: AbortSignal.timeout(2000),
  });
}
