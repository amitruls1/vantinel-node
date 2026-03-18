// ==========================================
// SESSION LIFECYCLE
// Sends start/step/end/error events to the Vantinel gateway
// ==========================================

import type { VantinelPluginConfig } from './types.js';

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  startedAt: number;
}

/**
 * Generate a session ID in the format oc_<timestamp>_<random>
 */
export function generateSessionId(): string {
  return `oc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * POST a session lifecycle event to the Vantinel gateway.
 * Fire-and-forget — errors are logged but never thrown.
 */
async function postSessionEvent(
  cfg: VantinelPluginConfig,
  event: 'start' | 'end' | 'step' | 'error',
  sessionId: string,
  agentId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const gatewayUrl = (cfg.gatewayUrl ?? 'https://api.vantinel.com').replace(/\/$/, '');
  try {
    await fetch(`${gatewayUrl}/v1/agents/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vantinel-API-Key': cfg.apiKey,
      },
      body: JSON.stringify({ event, session_id: sessionId, agent_id: agentId, metadata }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    console.warn(`[Vantinel] Failed to post session event '${event}':`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Start an agent session. Returns the session info for use throughout the session.
 */
export async function startSession(cfg: VantinelPluginConfig): Promise<SessionInfo> {
  const sessionId = generateSessionId();
  const agentId = cfg.mode === 'nemoclaw' ? 'nemoclaw-agent' : 'openclaw-agent';
  const info: SessionInfo = { sessionId, agentId, startedAt: Date.now() };

  await postSessionEvent(cfg, 'start', sessionId, agentId, {
    mode: cfg.mode ?? 'openclaw',
    host: process.env['HOSTNAME'] ?? 'unknown',
    plugin_version: '1.0.0',
  });

  return info;
}

/**
 * Record a step event (one tool call completed).
 */
export async function stepEvent(
  cfg: VantinelPluginConfig,
  session: SessionInfo,
  metadata?: Record<string, unknown>
): Promise<void> {
  await postSessionEvent(cfg, 'step', session.sessionId, session.agentId, metadata);
}

/**
 * End a session cleanly.
 */
export async function endSession(
  cfg: VantinelPluginConfig,
  session: SessionInfo
): Promise<void> {
  const durationMs = Date.now() - session.startedAt;
  await postSessionEvent(cfg, 'end', session.sessionId, session.agentId, {
    duration_ms: durationMs,
  });
}

/**
 * Record an error event and end the session.
 */
export async function errorSession(
  cfg: VantinelPluginConfig,
  session: SessionInfo,
  error: unknown
): Promise<void> {
  await postSessionEvent(cfg, 'error', session.sessionId, session.agentId, {
    error: error instanceof Error ? error.message : String(error),
  });
}
