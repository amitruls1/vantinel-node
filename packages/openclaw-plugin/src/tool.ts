// ==========================================
// GATEWAY TOOL CHECK
// POST /v1/events to get a decision for a pending tool call.
// Currently used for future `before_tool_call` hook wiring.
// ==========================================

import type { VantinelPluginConfig, GatewayDecision, GatewayDecisionResult, ToolCallContext } from './types.js';
import type { SessionInfo } from './session.js';

/**
 * Check a pending tool call against the Vantinel gateway.
 * Returns the gateway's enforcement decision.
 *
 * NOTE: As of March 2026, OpenClaw's `before_tool_call` hook is defined but not
 * yet called by the runtime (Issue #5943). This function is ready for when it ships.
 * The MCP proxy is the active enforcement path in the interim.
 */
export async function checkToolWithGateway(
  cfg: VantinelPluginConfig,
  session: SessionInfo,
  ctx: ToolCallContext
): Promise<GatewayDecisionResult> {
  const gatewayUrl = (cfg.gatewayUrl ?? 'https://api.vantinel.com').replace(/\/$/, '');
  const failClosed = cfg.failClosed ?? false;

  try {
    const res = await fetch(`${gatewayUrl}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vantinel-API-Key': cfg.apiKey,
      },
      body: JSON.stringify({
        event: 'tool_call',
        session_id: ctx.sessionId ?? session.sessionId,
        agent_id: session.agentId,
        tool_name: ctx.toolName,
        tool_args_hash: hashArgs(ctx.args),
        metadata: {
          mode: cfg.mode ?? 'openclaw',
          plugin: '@vantinel/openclaw-plugin',
        },
      }),
      signal: AbortSignal.timeout(2000),
    });

    if (!res.ok) {
      return failClosed
        ? { decision: 'block', reason: `Gateway returned HTTP ${res.status}` }
        : { decision: 'allow' };
    }

    const data = await res.json() as { decision?: GatewayDecision; reason?: string };
    const decision: GatewayDecision = data.decision ?? 'allow';
    return { decision, reason: data.reason, session_id: session.sessionId };
  } catch (err) {
    if (failClosed) {
      return {
        decision: 'block',
        reason: `Gateway unreachable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // Default to allow on error (fail-open)
    return { decision: 'allow' };
  }
}

/**
 * Simple deterministic hash of tool arguments for gateway deduplication.
 * Mirrors the MD5 approach used by the MCP proxy.
 */
function hashArgs(args: unknown): string {
  try {
    const sorted = sortedStringify(args);
    // Lightweight hash without requiring a crypto dependency
    let h = 0;
    for (let i = 0; i < sorted.length; i++) {
      h = (Math.imul(31, h) + sorted.charCodeAt(i)) | 0;
    }
    return `hash_${(h >>> 0).toString(16)}`;
  } catch {
    return 'hash_unknown';
  }
}

function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value.map(sortedStringify));
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).sort()) {
    sorted[key] = (value as Record<string, unknown>)[key];
  }
  return JSON.stringify(sorted);
}
