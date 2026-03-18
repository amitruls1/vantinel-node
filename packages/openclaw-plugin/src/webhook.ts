// ==========================================
// GATEWAY WEBHOOK HANDLER
// Receives block/require_approval push alerts from the Vantinel gateway
// Registered as POST /plugins/vantinel/webhook
// ==========================================

import type { OpenClawRequest, OpenClawResponse, GatewayWebhookPayload } from './types.js';

/** In-memory queue of recent gateway alerts (capped at 100) */
const recentAlerts: GatewayWebhookPayload[] = [];
const MAX_ALERTS = 100;

/**
 * HTTP handler registered with OpenClaw's plugin route system.
 * The gateway POSTs here when it blocks or flags a tool call.
 */
export function handleGatewayWebhook(req: OpenClawRequest, res: OpenClawResponse): void {
  let payload: GatewayWebhookPayload;

  try {
    payload = req.body as GatewayWebhookPayload;
    if (!payload?.type || !payload?.session_id) {
      res.status(400).json({ error: 'Invalid webhook payload: missing type or session_id' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  // Store for retrieval by the vantinel_status tool
  recentAlerts.unshift(payload);
  if (recentAlerts.length > MAX_ALERTS) {
    recentAlerts.length = MAX_ALERTS;
  }

  const label = payload.type === 'block' ? '⛔ BLOCKED' : payload.type === 'require_approval' ? '⏸️ APPROVAL REQUIRED' : '⚠️ WARNING';
  console.warn(
    `[Vantinel] ${label} — session=${payload.session_id} tool=${payload.tool_name}${payload.reason ? ` reason="${payload.reason}"` : ''}`
  );

  res.status(200).json({ ok: true });
}

/**
 * Return recent gateway alerts (used by the vantinel_status tool).
 */
export function getRecentAlerts(): GatewayWebhookPayload[] {
  return [...recentAlerts];
}
