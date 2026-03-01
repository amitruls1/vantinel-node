import { v4 as uuidv4 } from 'uuid';
import { hmacSign, validateCollectorUrl, generateNonce, redactApiKey } from './security';

export { validateCollectorUrl, redactApiKey } from './security';

export interface VantinelDecision {
  decision: 'allow' | 'block' | 'require_approval' | 'warn';
  message?: string;
  session_spend?: number;
  violations?: string[];
}

export interface VantinelConfig {
  apiKey?: string;
  clientId?: string;
  collectorUrl?: string;
  agentId?: string;
  dryRun?: boolean;
  shadowMode?: boolean;
  failMode?: 'open' | 'closed';
  slackWebhookUrl?: string;
  batchSize?: number;
  flushInterval?: number;
}

/**
 * Rough token estimation: ~4 characters per token.
 * Used when actual token counts aren't available.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Default cost estimation per 1k tokens (USD).
 * Applied as a rough fallback when model-specific pricing isn't available.
 */
const DEFAULT_COST_PER_1K_TOKENS = 0.01;

/**
 * Model pricing per 1k tokens (input, output, cache_read) in USD.
 */
const MODEL_PRICING: Record<string, { input: number; output: number; cache_read?: number }> = {
  // OpenAI 2026 Models
  'gpt-5.2': { input: 0.00175, output: 0.014 },
  'gpt-5.2-pro': { input: 0.021, output: 0.168 },
  'gpt-5-mini': { input: 0.00025, output: 0.002 },

  // OpenAI Legacy
  'gpt-4o': { input: 0.0025, output: 0.010 },
  'gpt-4o-2024-05-13': { input: 0.005, output: 0.015 },
  'gpt-4o-2024-08-06': { input: 0.0025, output: 0.010 },
  'gpt-4o-2024-11-20': { input: 0.0025, output: 0.010 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'o1': { input: 0.015, output: 0.060 },
  'o3-mini': { input: 0.0011, output: 0.0044 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },

  // Anthropic 2026 Models
  'claude-4.6-opus': { input: 0.005, output: 0.025 },
  'claude-4.6-sonnet': { input: 0.003, output: 0.015 },
  'claude-4.5-opus': { input: 0.005, output: 0.025 },
  'claude-4.5-sonnet': { input: 0.003, output: 0.015 },
  'claude-4.5-haiku': { input: 0.001, output: 0.005 },

  // Anthropic Legacy
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
  'claude-3-opus': { input: 0.015, output: 0.075 },

  // Google Models 2026
  'gemini-3.1-pro': { input: 0.002, output: 0.012 },
  'gemini-3.0-pro': { input: 0.002, output: 0.012 },
  'gemini-3-flash': { input: 0.0005, output: 0.003 },
  'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
};

/**
 * Estimate cost from tool args text.
 * NOTE: Only useful as a very rough fallback. Users should provide actual
 * cost from their LLM provider (e.g., OpenAI usage.total_tokens).
 */
function estimateCostFromText(text: string): number {
  const tokens = estimateTokens(text);
  return (tokens / 1000) * DEFAULT_COST_PER_1K_TOKENS;
}

/**
 * Estimate cost from model name and token counts.
 */
function estimateCostFromTokens(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0
): number {
  const pricing = MODEL_PRICING[model];
  if (pricing) {
    const regularInputTokens = Math.max(0, inputTokens - cachedTokens);
    const cacheReadPrice = pricing.cache_read !== undefined ? pricing.cache_read : pricing.input * 0.5;
    return (regularInputTokens / 1000) * pricing.input +
      (cachedTokens / 1000) * cacheReadPrice +
      (outputTokens / 1000) * pricing.output;
  }
  return ((inputTokens + outputTokens) / 1000) * DEFAULT_COST_PER_1K_TOKENS;
}

export interface ToolExecution {
  decision: VantinelDecision;
  /** Call this when the tool execution completes successfully. */
  success: (result?: unknown) => Promise<void>;
  /** Call this when the tool execution fails. */
  error: (errorMessage: string) => Promise<void>;
}

export class VantinelClient {
  private config: VantinelConfig;
  private sessionId: string;
  private globalMetadata: Record<string, unknown> = {};
  private eventQueue: object[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: VantinelConfig) {
    const mergedConfig: VantinelConfig = {
      collectorUrl: 'http://localhost:8000',
      agentId: 'browser-agent',
      batchSize: 1,
      flushInterval: 0,
      ...config,
    };
    mergedConfig.collectorUrl = validateCollectorUrl(mergedConfig.collectorUrl!);
    this.config = mergedConfig;
    this.sessionId = uuidv4();

    if (this.config.flushInterval && this.config.flushInterval > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => { });
      }, this.config.flushInterval);
    }
  }

  setGlobalMetadata(metadata: Record<string, unknown>): void {
    this.globalMetadata = { ...this.globalMetadata, ...metadata };
  }

  /**
   * Track a tool call. Sends the event to the collector and returns the decision.
   * NOTE: This does NOT automatically measure latency. Use `wrap()` instead for automatic timing.
   */
  async track(
    toolName: string,
    args: Record<string, unknown>,
    options?: {
      traceId?: string;
      skip?: boolean;
      latencyMs?: number;
      estimatedCost?: number;
    },
  ): Promise<VantinelDecision> {
    if (options?.skip === true) {
      return { decision: 'allow' };
    }

    const toolArgsHash = await this.hashArgs(toolName, args);

    // Only send cost if explicitly provided — don't fabricate estimates
    const estimatedCost = options?.estimatedCost;

    const event: Record<string, unknown> = {
      event_type: 'tool_call',
      session_id: this.sessionId,
      agent_id: this.config.agentId,
      tool_name: toolName,
      tool_args_hash: toolArgsHash,
      timestamp: Date.now(),
      latency_ms: options?.latencyMs,
      ...this.globalMetadata,
    };

    // Only include cost if actually provided
    if (estimatedCost !== undefined) {
      event.estimated_cost = estimatedCost;
    }

    if (options?.traceId !== undefined) {
      event['trace_id'] = options.traceId;
    }

    if (this.config.dryRun === true) {
      console.log('[Vantinel] dryRun — event not sent:', event);
      return { decision: 'allow' };
    }

    const batchSize = this.config.batchSize ?? 1;

    if (batchSize > 1) {
      this.eventQueue.push(event);
      if (this.eventQueue.length >= batchSize) {
        await this.flush();
      }
      return { decision: 'allow' };
    }

    const decision = await this.sendEvent(event);
    if (
      this.config.shadowMode &&
      (decision.decision === 'block' || decision.decision === 'require_approval')
    ) {
      const reason = decision.decision === 'block' ? 'Policy Violation' : 'Approval Required';
      const costStr =
        decision.session_spend !== undefined ? `$${decision.session_spend.toFixed(2)}` : 'unknown';
      console.warn(
        `[Vantinel Shadow] Would have blocked \`${toolName}\` (${reason}). Estimated savings: ${costStr}`,
      );
      if (this.config.slackWebhookUrl) {
        fetch(this.config.slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `🚨 *Vantinel Shadow Alert*: Would have blocked \`${toolName}\` (${reason}). Estimated savings: *${costStr}*\n_Session: ${this.sessionId}_`,
          }),
        }).catch(() => { });
      }
      return { decision: 'allow' };
    }
    return decision;
  }

  /**
   * Wrap a tool function — automatically measures latency and tracks it.
   * This is the recommended way to use Vantinel.
   *
   * Cost is only reported if you explicitly provide it (e.g., from your LLM provider's usage data).
   * Latency is always automatically measured.
   *
   * @example
   * // Basic usage — auto-measures latency
   * const result = await client.wrap('search_database', { query: 'test' }, async () => {
   *   return await searchDatabase('test');
   * });
   *
   * @example
   * // With cost from OpenAI usage
   * const result = await client.wrap('gpt4_call', { prompt: '...' }, async () => {
   *   const completion = await openai.chat.completions.create({...});
   *   return completion;
   * }, { estimatedCost: calculateCostFromUsage(completion.usage) });
   */
  async wrap<T>(
    toolName: string,
    args: Record<string, unknown>,
    fn: () => T | Promise<T>,
    options?: { traceId?: string; skip?: boolean; estimatedCost?: number },
  ): Promise<T> {
    if (options?.skip === true) {
      return fn();
    }

    const startTime = performance.now();

    // Pre-check with the gateway (no latency yet — this is the pre-call check)
    const decision = await this.track(toolName, args, {
      traceId: options?.traceId,
      estimatedCost: options?.estimatedCost,
    });

    if (decision.decision === 'block') {
      throw new Error(`[Vantinel] Tool call blocked: ${toolName} — ${decision.message || 'Policy violation'}`);
    }

    try {
      const result = await fn();
      const latencyMs = performance.now() - startTime;

      // Send completion event with measured latency
      await this.track(toolName, args, {
        traceId: options?.traceId,
        latencyMs,
        estimatedCost: options?.estimatedCost,
      });

      return result;
    } catch (err) {
      const latencyMs = performance.now() - startTime;

      // Report error with measured latency
      await this.captureError(
        toolName,
        err instanceof Error ? err : new Error(String(err)),
        { latency_ms: latencyMs },
      );

      throw err;
    }
  }

  /**
   * Auto-instrument an OpenAI client.
   * This monkey-patches `chat.completions.create` to automatically intercept calls,
   * measure latency, extract exact token usage from the response, and calculate true cost.
   * 
   * @param openaiClient - The instantiated OpenAI client (e.g., `new OpenAI()`)
   * @param options - Optional configuration for the intercepted calls
   * @returns The patched OpenAI client
   */
  wrapOpenAI(openaiClient: any, options?: { sessionId?: string; traceId?: string }): any {
    if (!openaiClient?.chat?.completions?.create) {
      console.warn('[Vantinel] Provided client does not look like an OpenAI client. wrapOpenAI failed.');
      return openaiClient;
    }

    const originalCreate = openaiClient.chat.completions.create.bind(openaiClient.chat.completions);

    openaiClient.chat.completions.create = async (body: any, reqOptions?: any) => {
      const toolName = 'openai_chat';
      const argsText = typeof body === 'string' ? body : JSON.stringify(body);
      const sessionId = options?.sessionId || this.sessionId;

      const isStream = body?.stream === true || reqOptions?.stream === true;
      if (isStream) {
        if (!body.stream_options) {
          body.stream_options = { include_usage: true };
        }
      }

      const startTime = performance.now();

      // Pre-check with the gateway
      const decision = await this.track(toolName, { payload: argsText }, {
        traceId: options?.traceId,
      });

      if (decision.decision === 'block') {
        throw new Error(
          `[Vantinel] Tool call blocked: ${toolName} — ${decision.message || 'Policy violation'}`,
        );
      }

      try {
        const response = await originalCreate(body, reqOptions);

        if (isStream) {
          const self = this;
          async function* wrapper() {
            let finalUsage: any = null;
            let finalModel = body.model;
            try {
              for await (const chunk of response) {
                if (chunk.usage) finalUsage = chunk.usage;
                if (chunk.model) finalModel = chunk.model;
                yield chunk;
              }
            } finally {
              const latencyMs = performance.now() - startTime;
              let estimatedCost: number | undefined = undefined;
              if (finalUsage && finalModel) {
                const cachedTokens = finalUsage.prompt_tokens_details?.cached_tokens || 0;
                estimatedCost = estimateCostFromTokens(
                  finalModel,
                  finalUsage.prompt_tokens || 0,
                  finalUsage.completion_tokens || 0,
                  cachedTokens
                );
              }
              self.track(toolName, { payload: argsText }, {
                traceId: options?.traceId,
                latencyMs,
                estimatedCost,
              }).catch(() => { });
            }
          }
          return wrapper();
        }

        const latencyMs = performance.now() - startTime;

        // Calculate exact cost from the actual usage reported by OpenAI!
        let estimatedCost: number | undefined = undefined;
        if (response.usage && response.model) {
          const cachedTokens = response.usage.prompt_tokens_details?.cached_tokens || 0;
          estimatedCost = estimateCostFromTokens(
            response.model,
            response.usage.prompt_tokens || 0,
            response.usage.completion_tokens || 0,
            cachedTokens
          );
        }

        // Send completion with latency and true cost
        await this.track(toolName, { payload: argsText }, {
          traceId: options?.traceId,
          latencyMs,
          estimatedCost,
        });

        return response;
      } catch (err) {
        const latencyMs = performance.now() - startTime;

        // Report error with latency
        await this.captureError(
          toolName,
          err instanceof Error ? err : new Error(String(err)),
          { latency_ms: latencyMs },
        );
        throw err;
      }
    };

    return openaiClient;
  }

  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const batch = this.eventQueue.splice(0, this.eventQueue.length);

    for (const event of batch) {
      await this.sendEvent(event).catch(() => { });
    }
  }

  startTrace(): string {
    return uuidv4();
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.config.collectorUrl}/health`);
      const latencyMs = Date.now() - start;
      return { ok: response.ok, latencyMs };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  async captureError(
    toolName: string,
    error: Error,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const event: Record<string, unknown> = {
      event_type: 'tool_error',
      session_id: this.sessionId,
      agent_id: this.config.agentId,
      tool_name: toolName,
      error_message: error.message,
      error_name: error.name,
      timestamp: Date.now(),
      ...this.globalMetadata,
      ...metadata,
    };

    if (this.config.dryRun === true) {
      console.log('[Vantinel] dryRun — error event not sent:', event);
      return;
    }

    await this.sendEvent(event).catch(() => { });
  }

  private async sendEvent(event: object): Promise<VantinelDecision> {
    try {
      const body = JSON.stringify(event);
      const timestamp = Date.now();
      const nonce = generateNonce();
      const signature = await hmacSign(this.config.apiKey || '', timestamp, body);

      const response = await fetch(`${this.config.collectorUrl}/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vantinel-Signature': signature,
          'X-Vantinel-Timestamp': String(timestamp),
          'X-Vantinel-Nonce': nonce,
          'X-Vantinel-Client': this.config.apiKey ? redactApiKey(this.config.apiKey) : '',
          'X-Vantinel-API-Key': this.config.apiKey || '',
        },
        body,
      });
      const data = (await response.json()) as VantinelDecision;
      return data;
    } catch (err) {
      console.warn('[Vantinel] Failed to send event', err);
      if (this.config.failMode === 'closed') {
        return { decision: 'block', message: 'Vantinel Gateway is unreachable and failMode is closed.' };
      }
      return { decision: 'allow' };
    }
  }

  private async hashArgs(toolName: string, args: Record<string, unknown>): Promise<string> {
    const str = toolName + JSON.stringify(args);
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
}

// Re-export cost estimation utilities for advanced users
export { estimateCostFromTokens, estimateCostFromText, estimateTokens, MODEL_PRICING };
