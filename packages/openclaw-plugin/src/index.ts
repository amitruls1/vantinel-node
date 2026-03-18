/**
 * @vantinel/openclaw-plugin
 *
 * OpenClaw plugin providing real-time guardrails and observability
 * via the Vantinel gateway.
 *
 *   openclaw plugins install @vantinel/openclaw-plugin
 *   openclaw plugins config @vantinel/openclaw-plugin apiKey vntl_...
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { z } from 'zod';
import type {
  VantinelPluginConfig,
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolContext,
  PluginHookSessionStartEvent,
  PluginHookSessionEndEvent,
  PluginHookSessionContext,
  PluginHookAfterToolCallEvent,
} from './types.js';
import { startSession, endSession, stepSession } from './session.js';
import { handleGatewayWebhook, getRecentAlerts } from './webhook.js';
import { checkToolWithGateway } from './tool.js';

const sessions = new Map<string, Awaited<ReturnType<typeof startSession>>>();

const configSchema = z.object({
  apiKey: z.string().optional().default(''),
  gatewayUrl: z.string().optional(),
  mode: z.enum(['openclaw', 'nemoclaw']).optional(),
  failClosed: z.boolean().optional(),
});

const plugin = {
  id: 'openclaw-plugin',
  name: 'Vantinel Guardrails',
  description: 'Real-time policy enforcement and observability for OpenClaw agents',
  configSchema,

  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig ?? {}) as unknown as VantinelPluginConfig;
    const base = (cfg.gatewayUrl ?? 'https://api.vantinel.com').replace(/\/$/, '');

    if (!cfg.apiKey) {
      api.logger.warn('Vantinel: apiKey not set. Run: openclaw plugins config @vantinel/openclaw-plugin apiKey vntl_...');
      return;
    }

    // 1. Track session lifecycle via OpenClaw hooks
    api.on(
      'session_start',
      async (event: PluginHookSessionStartEvent, ctx: PluginHookSessionContext) => {
        const agentId = ctx.agentId ?? (cfg.mode === 'nemoclaw' ? 'nemoclaw-agent' : 'openclaw-agent');
        const state = await startSession(cfg, event.sessionId, agentId);
        sessions.set(event.sessionId, state);
        api.logger.info(`Vantinel: session started ${event.sessionId}`);
      }
    );

    api.on(
      'session_end',
      async (event: PluginHookSessionEndEvent, _ctx: PluginHookSessionContext) => {
        const state = sessions.get(event.sessionId);
        if (state) {
          await endSession(cfg, state);
          sessions.delete(event.sessionId);
          api.logger.info(`Vantinel: session ended ${event.sessionId} (${event.durationMs ?? 0}ms)`);
        }
      }
    );

    // 3. before_tool_call — check gateway, block if needed (wired in OpenClaw 2026.2+)
    api.on(
      'before_tool_call',
      async (
        event: PluginHookBeforeToolCallEvent,
        ctx: PluginHookToolContext
      ): Promise<PluginHookBeforeToolCallResult | void> => {
        const state = ctx.sessionKey ? sessions.get(ctx.sessionKey) : undefined;
        if (!state) return;

        const result = await checkToolWithGateway(cfg, state, event.toolName, event.params);

        if (result.decision === 'block') {
          api.logger.warn(`Vantinel: ⛔ BLOCKED ${event.toolName} — ${result.reason ?? 'policy violation'}`);
          return { block: true, blockReason: result.reason ?? 'Blocked by Vantinel policy' };
        }
        if (result.decision === 'require_approval') {
          api.logger.warn(`Vantinel: ⏸️ APPROVAL REQUIRED for ${event.toolName}`);
          return { block: true, blockReason: `Approval required. Dashboard: ${base.replace(':8000', ':3000')}/approvals` };
        }
        if (result.decision === 'warn') {
          api.logger.warn(`Vantinel: ⚠️ WARNING on ${event.toolName} — ${result.reason ?? ''}`);
        }
      }
    );

    // 4. after_tool_call — count steps
    api.on(
      'after_tool_call',
      (_event: PluginHookAfterToolCallEvent, ctx: PluginHookToolContext) => {
        const state = ctx.sessionKey ? sessions.get(ctx.sessionKey) : undefined;
        if (state) void stepSession(cfg, state, _event.toolName).catch(() => {});
      }
    );

    // 5. Webhook for gateway-push block/approval alerts
    api.registerHttpRoute({ path: '/plugins/vantinel/webhook', handler: handleGatewayWebhook });

    // 6. /vantinel slash command — status check
    api.registerCommand({
      name: 'vantinel',
      description: 'Show Vantinel guardrail status for the current session',
      handler: async () => {
        const sessionId = [...sessions.keys()].at(-1);
        const state = sessionId ? sessions.get(sessionId) : undefined;
        const alerts = getRecentAlerts().slice(0, 3);

        try {
          const res = await fetch(
            `${base}/v1/integrations/status${sessionId ? `?session_id=${sessionId}` : ''}`,
            { headers: { 'X-Vantinel-API-Key': cfg.apiKey }, signal: AbortSignal.timeout(3000) }
          );
          const data = await res.json() as Record<string, unknown>;
          const sess = data['session'] as Record<string, unknown> | undefined;
          const lines = [
            `🛡️ Vantinel Guardrails — connected`,
            `Session: ${sessionId ?? 'none'}`,
            state ? `Steps: ${state.stepCount}` : '',
            sess ? `Cost: $${Number(sess['total_cost'] ?? 0).toFixed(4)}` : '',
            alerts.length ? `Alerts: ${alerts.map((a) => `${a.type}:${a.tool_name}`).join(', ')}` : '',
            `Dashboard: ${base.replace(':8000', ':3000')}/agents${sessionId ? `/${sessionId}` : ''}`,
          ].filter(Boolean);
          return { text: lines.join('\n') };
        } catch {
          return { text: `🛡️ Vantinel: gateway unreachable at ${base}` };
        }
      },
    });

    api.logger.info('Vantinel: plugin ready — guardrails active');
  },
};

export default plugin;
