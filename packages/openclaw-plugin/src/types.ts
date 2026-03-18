// Only OpenClawPluginApi, OpenClawPluginService, OpenClawPluginServiceContext
// are exported from openclaw/plugin-sdk. Hook event types are defined locally.
export type { OpenClawPluginApi } from 'openclaw/plugin-sdk';

// ── Hook event types (mirrored from openclaw/dist/plugin-sdk/plugins/types.d.ts) ──

export type PluginHookBeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
};

export type PluginHookBeforeToolCallResult = {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
};

export type PluginHookAfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
};

export type PluginHookToolContext = {
  agentId?: string;
  sessionKey?: string;
  toolName: string;
};

export type PluginHookSessionStartEvent = {
  sessionId: string;
  resumedFrom?: string;
};

export type PluginHookSessionEndEvent = {
  sessionId: string;
  messageCount: number;
  durationMs?: number;
};

export type PluginHookSessionContext = {
  agentId?: string;
  sessionId: string;
};

// ── Plugin config ──

export interface VantinelPluginConfig {
  /** Vantinel API key (vntl_... or vntg_...) */
  apiKey: string;
  /** Vantinel gateway URL. Defaults to https://api.vantinel.com */
  gatewayUrl?: string;
  /** Mode: openclaw or nemoclaw. Default: openclaw */
  mode?: 'openclaw' | 'nemoclaw';
  /** Block tool calls when gateway is unreachable. Default: false */
  failClosed?: boolean;
}

export interface GatewayDecisionResult {
  decision: 'allow' | 'block' | 'require_approval' | 'warn';
  reason?: string;
}
