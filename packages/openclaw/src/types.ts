export interface OpenclawSetupConfig {
  /** Vantinel API key (starts with vntl_) */
  apiKey: string;
  /** Gateway URL, defaults to http://localhost:8000 */
  gatewayUrl?: string;
  /** Agent ID for this OpenClaw instance */
  agentId?: string;
  /** Session budget in USD. 0 = unlimited */
  sessionBudget?: number;
  /** Whether to start MCP proxy wrapper automatically */
  startMcpProxy?: boolean;
  /** Mode for MCP proxy: openclaw, nemoclaw, generic */
  proxyMode?: 'openclaw' | 'nemoclaw' | 'generic';
  /** Dashboard URL for deep-links */
  dashboardUrl?: string;
}

export interface SetupResult {
  ok: boolean;
  gatewayUrl: string;
  gatewayLatencyMs?: number;
  configWritten: boolean;
  configPath: string;
  proxyStarted: boolean;
  errors: string[];
}

export interface OpenclawClientWrapper {
  /** The underlying VantinelClient for direct use */
  sendSessionEvent(event: 'start' | 'end' | 'step' | 'error', sessionId: string, metadata?: Record<string, unknown>): Promise<void>;
  destroy(): Promise<void>;
}
