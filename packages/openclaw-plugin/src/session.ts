import type { VantinelPluginConfig } from './types.js';

export interface SessionState {
  sessionId: string;
  agentId: string;
  startedAt: number;
  stepCount: number;
}

async function post(cfg: VantinelPluginConfig, body: Record<string, unknown>): Promise<void> {
  const base = (cfg.gatewayUrl ?? 'https://api.vantinel.com').replace(/\/$/, '');
  try {
    await fetch(`${base}/v1/agents/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vantinel-API-Key': cfg.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    // fire-and-forget — never block the agent
  }
}

export async function startSession(
  cfg: VantinelPluginConfig,
  sessionId: string,
  agentId?: string
): Promise<SessionState> {
  const aid = agentId ?? (cfg.mode === 'nemoclaw' ? 'nemoclaw-agent' : 'openclaw-agent');
  const state: SessionState = { sessionId, agentId: aid, startedAt: Date.now(), stepCount: 0 };
  await post(cfg, {
    event: 'start',
    session_id: sessionId,
    agent_id: aid,
    metadata: { mode: cfg.mode ?? 'openclaw', plugin_version: '1.0.1' },
  });
  return state;
}

export async function endSession(cfg: VantinelPluginConfig, state: SessionState): Promise<void> {
  await post(cfg, {
    event: 'end',
    session_id: state.sessionId,
    agent_id: state.agentId,
    metadata: { duration_ms: Date.now() - state.startedAt, steps: state.stepCount },
  });
}

export async function stepSession(cfg: VantinelPluginConfig, state: SessionState, toolName: string): Promise<void> {
  state.stepCount++;
  await post(cfg, {
    event: 'step',
    session_id: state.sessionId,
    agent_id: state.agentId,
    metadata: { tool_name: toolName, step: state.stepCount },
  });
}
