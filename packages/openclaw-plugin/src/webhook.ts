import type { IncomingMessage, ServerResponse } from 'node:http';

export interface GatewayWebhookPayload {
  type: 'block' | 'require_approval' | 'warn';
  session_id: string;
  tool_name: string;
  reason?: string;
  timestamp: string;
}

const recentAlerts: GatewayWebhookPayload[] = [];
const MAX_ALERTS = 100;

export function handleGatewayWebhook(req: IncomingMessage, res: ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body) as GatewayWebhookPayload;
      if (!payload?.type || !payload?.session_id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
        return;
      }
      recentAlerts.unshift(payload);
      if (recentAlerts.length > MAX_ALERTS) recentAlerts.length = MAX_ALERTS;

      const label = payload.type === 'block' ? '⛔ BLOCKED' : payload.type === 'require_approval' ? '⏸️ APPROVAL' : '⚠️ WARN';
      console.warn(`[Vantinel] ${label} session=${payload.session_id} tool=${payload.tool_name}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
}

export function getRecentAlerts(): GatewayWebhookPayload[] {
  return [...recentAlerts];
}
