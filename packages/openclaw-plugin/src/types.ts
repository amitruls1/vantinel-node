// ==========================================
// TYPE STUBS: VantinelPluginConfig + OpenClawPluginApi
// ==========================================

export interface VantinelPluginConfig {
  /** Vantinel API key (vntl_...) */
  apiKey: string;
  /** Vantinel gateway URL. Defaults to https://api.vantinel.com */
  gatewayUrl?: string;
  /** Mode: openclaw or nemoclaw */
  mode?: 'openclaw' | 'nemoclaw';
  /** If true, block tool calls when gateway is unreachable. Default: false */
  failClosed?: boolean;
}

/** Decision returned by the gateway for a tool call */
export type GatewayDecision = 'allow' | 'block' | 'require_approval' | 'warn';

export interface GatewayDecisionResult {
  decision: GatewayDecision;
  reason?: string;
  session_id?: string;
}

/** Context passed to before_tool_call hook */
export interface ToolCallContext {
  toolName: string;
  args: unknown;
  sessionId?: string;
}

/** Webhook payload pushed from the gateway for block/approval events */
export interface GatewayWebhookPayload {
  type: 'block' | 'require_approval' | 'warn';
  session_id: string;
  tool_name: string;
  reason?: string;
  timestamp: string;
}

/**
 * Minimal type stubs for the OpenClaw Plugin API.
 * Replace with the official @openclaw/plugin-api types when available.
 */
export interface OpenClawPluginApi {
  /** Returns the plugin's config, typed as T */
  getConfig<T = Record<string, unknown>>(): T;

  /**
   * Register an HTTP route within the OpenClaw server process.
   * Used to receive webhook pushes from the gateway.
   */
  registerHttpRoute(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    handler: (req: OpenClawRequest, res: OpenClawResponse) => void | Promise<void>
  ): void;

  /**
   * Register a tool the agent can call.
   */
  registerTool(
    name: string,
    schema: { description: string; parameters?: Record<string, unknown> },
    handler: (args?: Record<string, unknown>) => unknown | Promise<unknown>
  ): void;

  /**
   * Register a lifecycle hook.
   * NOTE: 'before_tool_call' is defined but not yet wired in OpenClaw as of March 2026
   * (Issue #5943). Registering it is safe and future-compatible.
   */
  registerHook(
    event: 'before_tool_call' | 'after_tool_call' | 'session_start' | 'session_end',
    handler: (ctx: ToolCallContext) => GatewayDecision | void | Promise<GatewayDecision | void>
  ): void;
}

/** Minimal HTTP request/response stubs for the plugin webhook handler */
export interface OpenClawRequest {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface OpenClawResponse {
  status(code: number): OpenClawResponse;
  json(body: unknown): void;
  send(body?: string): void;
}
