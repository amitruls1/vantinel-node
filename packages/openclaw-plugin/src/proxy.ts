// ==========================================
// MCP PROXY CONFIGURATION
// Writes Vantinel MCP proxy entry into openclaw.json on plugin install
// ==========================================

import { writeOpenclawConfig } from '@vantinel/openclaw';
import type { VantinelPluginConfig } from './types.js';

/**
 * Write the Vantinel MCP proxy server entry into ~/.openclaw/openclaw.json.
 * Uses the deep-merge logic from @vantinel/openclaw so existing config is preserved.
 */
export async function configureMcpProxy(cfg: VantinelPluginConfig): Promise<string> {
  const gatewayUrl = (cfg.gatewayUrl ?? 'https://api.vantinel.com').replace(/\/$/, '');
  const mode = cfg.mode ?? 'openclaw';

  const mcpProxyEntry = {
    mcpServers: {
      'vantinel-proxy': {
        command: 'npx',
        args: [
          'vantinel-mcp-proxy',
          '--mode', mode,
          '--',
          // Placeholder: replaced by user's actual MCP server command
          'openclaw-mcp-server',
        ],
        env: {
          VANTINEL_API_KEY: cfg.apiKey,
          VANTINEL_COLLECTOR_URL: gatewayUrl,
          VANTINEL_MODE: mode,
        },
      },
    },
    // Also write the LLM gateway + OTLP config via the standard fragment
    models: {
      providers: {
        vantinel: {
          baseUrl: `${gatewayUrl}/v1`,
          apiKey: cfg.apiKey,
          type: 'openai',
        },
      },
    },
    'diagnostics-otel': {
      enabled: true,
      endpoint: `${gatewayUrl}/v1/traces`,
      protocol: 'http/json',
      headers: {
        'X-Vantinel-API-Key': cfg.apiKey,
      },
    },
  };

  const configPath = writeOpenclawConfig(mcpProxyEntry);
  return configPath;
}
