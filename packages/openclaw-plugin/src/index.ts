// ==========================================
// @vantinel/openclaw-plugin
// OpenClaw plugin entry point — called by OpenClaw on install/startup
// ==========================================

import type { OpenClawPluginApi, VantinelPluginConfig } from './types.js';
import { startSession, endSession, stepEvent } from './session.js';
import { configureMcpProxy } from './proxy.js';
import { handleGatewayWebhook, getRecentAlerts } from './webhook.js';
import { checkToolWithGateway } from './tool.js';

export type { VantinelPluginConfig, OpenClawPluginApi, GatewayDecision } from './types.js';
export { startSession, endSession, stepEvent, errorSession } from './session.js'; // re-exported for programmatic use
export { configureMcpProxy } from './proxy.js';
export { handleGatewayWebhook, getRecentAlerts } from './webhook.js';
export { checkToolWithGateway } from './tool.js';

/**
 * OpenClaw plugin entry point.
 * OpenClaw calls this on startup after loading the plugin.
 *
 * @example
 * // openclaw.json
 * {
 *   "plugins": {
 *     "entries": {
 *       "@vantinel/openclaw-plugin": {
 *         "config": { "apiKey": "vntl_..." }
 *       }
 *     }
 *   }
 * }
 */
export async function register(api: OpenClawPluginApi): Promise<void> {
  const cfg = api.getConfig<VantinelPluginConfig>();

  if (!cfg.apiKey) {
    console.error('[Vantinel] Plugin not configured: apiKey is required. Run: openclaw plugins config @vantinel/openclaw-plugin apiKey vntl_...');
    return;
  }

  // 1. Write MCP proxy + LLM gateway + OTLP config into openclaw.json
  let configPath = '(unknown)';
  try {
    configPath = await configureMcpProxy(cfg);
    console.info(`[Vantinel] Config written to ${configPath}`);
  } catch (err) {
    console.warn('[Vantinel] Failed to configure MCP proxy:', err instanceof Error ? err.message : String(err));
  }

  // 2. Start agent session — fire-and-forget, never blocks startup
  const session = await startSession(cfg);
  console.info(`[Vantinel] Session started: ${session.sessionId}`);

  // 3. Register HTTP webhook route for gateway push alerts (block/require_approval events)
  api.registerHttpRoute('POST', '/plugins/vantinel/webhook', handleGatewayWebhook);

  // 4. Register vantinel_status tool the agent can call to check its own standing
  api.registerTool(
    'vantinel_status',
    {
      description:
        'Check the current Vantinel guardrails status for this agent session. ' +
        'Returns session ID, cost, step count, and any recent policy alerts.',
    },
    async () => {
      const gatewayUrl = (cfg.gatewayUrl ?? 'https://api.vantinel.com').replace(/\/$/, '');
      try {
        const res = await fetch(
          `${gatewayUrl}/v1/integrations/status?session_id=${encodeURIComponent(session.sessionId)}`,
          {
            headers: { 'X-Vantinel-API-Key': cfg.apiKey },
            signal: AbortSignal.timeout(3000),
          }
        );
        const data = await res.json() as Record<string, unknown>;
        return {
          ...data,
          recent_alerts: getRecentAlerts().slice(0, 5),
          dashboard_url: `${cfg.gatewayUrl?.replace('8000', '3000') ?? 'https://app.vantinel.com'}/agents/${session.sessionId}`,
        };
      } catch {
        return {
          status: 'running',
          session_id: session.sessionId,
          recent_alerts: getRecentAlerts().slice(0, 5),
          error: 'Could not reach gateway',
        };
      }
    }
  );

  // 5. Register before_tool_call hook (no-op until OpenClaw wires it — Issue #5943)
  //    Safe to register now; will activate automatically in a future OpenClaw release.
  api.registerHook('before_tool_call', async (ctx) => {
    const result = await checkToolWithGateway(cfg, session, ctx);

    if (result.decision === 'block') {
      // When the hook is active, returning 'block' halts execution
      return 'block';
    }
    if (result.decision === 'require_approval') {
      return 'require_approval';
    }

    // Record step for allowed/warned calls
    void stepEvent(cfg, session, { tool_name: ctx.toolName }).catch(() => {});
    return 'allow';
  });

  // 6. End session cleanly on process exit
  const cleanup = () => {
    void endSession(cfg, session).catch(() => {});
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  console.info('[Vantinel] Plugin ready. Guardrails active via MCP proxy.');
}
