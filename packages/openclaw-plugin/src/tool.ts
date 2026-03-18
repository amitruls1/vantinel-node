import type { VantinelPluginConfig, GatewayDecisionResult } from './types.js';
import type { SessionState } from './session.js';

/**
 * Check a tool call against the gateway and return an enforcement decision.
 * Used by the before_tool_call hook.
 */
export async function checkToolWithGateway(
  cfg: VantinelPluginConfig,
  session: SessionState,
  toolName: string,
  params: Record<string, unknown>
): Promise<GatewayDecisionResult> {
  const base = (cfg.gatewayUrl ?? 'https://api.vantinel.com').replace(/\/$/, '');
  const failClosed = cfg.failClosed ?? false;

  try {
    const res = await fetch(`${base}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vantinel-API-Key': cfg.apiKey },
      body: JSON.stringify({
        event: 'tool_call',
        session_id: session.sessionId,
        agent_id: session.agentId,
        tool_name: toolName,
        tool_args_hash: hashArgs(params),
        metadata: { mode: cfg.mode ?? 'openclaw', plugin: '@vantinel/openclaw-plugin' },
      }),
      signal: AbortSignal.timeout(2000),
    });

    if (!res.ok) {
      return failClosed
        ? { decision: 'block', reason: `Gateway HTTP ${res.status}` }
        : { decision: 'allow' };
    }

    const data = await res.json() as { decision?: string; reason?: string };
    const decision = (data.decision as GatewayDecisionResult['decision']) ?? 'allow';
    return { decision, reason: data.reason };
  } catch {
    return failClosed
      ? { decision: 'block', reason: 'Gateway unreachable' }
      : { decision: 'allow' };
  }
}

function hashArgs(args: unknown): string {
  try {
    const s = sortedStringify(args);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return `hash_${(h >>> 0).toString(16)}`;
  } catch {
    return 'hash_unknown';
  }
}

function sortedStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(sortedStringify).join(',')}]`;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(v as object).sort()) sorted[k] = (v as Record<string, unknown>)[k];
  return JSON.stringify(sorted);
}
