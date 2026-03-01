import axios, { AxiosInstance } from 'axios';
import { hmacSign, validateCollectorUrl, generateNonce } from './security';

export interface VantinelConfig {
  apiKey?: string;
  clientId?: string;
  collectorUrl?: string;
  agentId?: string;
  dryRun?: boolean;
  shadowMode?: boolean;
  failMode?: 'open' | 'closed';
  batchSize?: number;
  flushInterval?: number;
  retry?: {
    maxRetries?: number;
    backoffMs?: number;
  };
  slackWebhookUrl?: string;
}

export interface VantinelEvent {
  client_id?: string;
  session_id: string;
  agent_id?: string;
  tool_name: string;
  tool_args_hash: string;
  timestamp: number;
  latency_ms?: number;
  estimated_cost?: number;
  event_type?: string;
  trace_id?: string;
  metadata?: Record<string, unknown>;
}

export interface VantinelDecision {
  decision: 'allow' | 'block' | 'require_approval' | 'warn';
  message?: string;
  session_spend?: number;
  violations?: string[];
}

/**
 * Rough token estimation: ~4 characters per token.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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

function estimateCostFromText(text: string): number {
  const tokens = estimateTokens(text);
  return (tokens / 1000) * DEFAULT_COST_PER_1K_TOKENS;
}

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

export class VantinelClient {
  private client: AxiosInstance;
  private config: VantinelConfig;
  private batchQueue: VantinelEvent[];
  private flushTimer: ReturnType<typeof setInterval> | null;
  private globalMetadata: Record<string, unknown>;

  constructor(config: VantinelConfig) {
    this.config = config;
    this.batchQueue = [];
    this.flushTimer = null;
    this.globalMetadata = {};

    const validatedUrl = validateCollectorUrl(config.collectorUrl || 'http://localhost:8000');
    this.client = axios.create({
      baseURL: validatedUrl,
      timeout: 2000,
    });

    const interval = config.flushInterval ?? 0;
    if (interval > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch((err: Error) => {
          console.warn('[Vantinel] Background flush failed:', err.message);
        });
      }, interval);
      // Prevent the timer from keeping the Node.js process alive
      if (this.flushTimer.unref) {
        this.flushTimer.unref();
      }
    }
  }

  setGlobalMetadata(metadata: Record<string, unknown>): void {
    this.globalMetadata = { ...this.globalMetadata, ...metadata };
  }

  private mergeGlobalMetadata(event: VantinelEvent): VantinelEvent {
    if (Object.keys(this.globalMetadata).length === 0) return event;
    return {
      ...event,
      metadata: { ...this.globalMetadata, ...(event.metadata ?? {}) },
    };
  }

  private async sendWithRetry(events: VantinelEvent[]): Promise<VantinelDecision> {
    const maxRetries = this.config.retry?.maxRetries ?? 0;
    const backoffMs = this.config.retry?.backoffMs ?? 100;

    const payload = events.length === 1 ? events[0] : events;
    const body = JSON.stringify(payload);
    const timestamp = Date.now();
    const nonce = generateNonce();
    const signature = hmacSign(this.config.apiKey || '', timestamp, body);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Vantinel-Signature': signature,
      'X-Vantinel-Timestamp': String(timestamp),
      'X-Vantinel-Nonce': nonce,
      'X-Vantinel-Client': this.config.clientId || '',
      'X-Vantinel-API-Key': this.config.apiKey || '',
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs * attempt));
      }

      try {
        const response = await this.client.post('/v1/events', body, { headers });
        // For batch sends (array payload), return a generic allow
        if (Array.isArray(payload)) {
          return { decision: 'allow' };
        }
        return response.data as VantinelDecision;
      } catch (error: any) {
        const status: number | undefined = error.response?.status;
        // Retry on network errors or 5xx
        if (!status || status >= 500) {
          lastError = error;
          continue;
        }
        // Non-retryable error (4xx etc.)
        console.warn('[Vantinel] Non-retryable error from collector:', error.message);
        if (this.config.failMode === 'closed') {
          return { decision: 'block', message: 'Vantinel Gateway returned non-retryable error and failMode is closed.' };
        }
        return { decision: 'allow' };
      }
    }

    console.warn(
      '[Vantinel] Failed to contact collector after retries:',
      lastError?.message,
    );
    if (this.config.failMode === 'closed') {
      return { decision: 'block', message: 'Vantinel Gateway is unreachable and failMode is closed.' };
    }
    return { decision: 'allow' };
  }

  /**
   * Send an event to the collector.
   * Cost is only included if explicitly set on the event.
   */
  async sendEvent(event: VantinelEvent): Promise<VantinelDecision> {
    const enriched = this.mergeGlobalMetadata(event);

    if (this.config.dryRun) {
      console.log('[Vantinel DryRun] Event:', enriched);
      return { decision: 'allow' };
    }

    const batchSize = this.config.batchSize ?? 1;

    if (batchSize <= 1) {
      // No batching — send immediately
      return this.sendWithRetry([enriched]);
    }

    // Batching mode — buffer and flush when full
    return new Promise<VantinelDecision>((resolve) => {
      this.batchQueue.push(enriched);

      if (this.batchQueue.length >= batchSize) {
        const batch = this.batchQueue.splice(0, batchSize);
        this.sendWithRetry(batch)
          .then((decision) => resolve(decision))
          .catch(() => resolve(this.config.failMode === 'closed' ? { decision: 'block', message: 'Failed to send batch and failMode is closed.' } : { decision: 'allow' }));
      } else {
        // Resolve immediately with allow; batch will be sent when full or on flush()
        resolve({ decision: 'allow' });
      }
    });
  }

  /**
   * Wrap a tool function — automatically measures latency and tracks it.
   * This is the recommended way to use Vantinel.
   *
   * Cost is only reported if you explicitly provide it (e.g., from your LLM provider's usage data).
   * Latency is always automatically measured.
   *
   * @example
   * const result = await client.wrap('search_db', '{"query":"test"}', async () => {
   *   return await searchDatabase('test');
   * });
   */
  async wrap<T>(
    toolName: string,
    toolArgs: string,
    fn: () => T | Promise<T>,
    options?: {
      sessionId?: string;
      estimatedCost?: number;
      traceId?: string;
    },
  ): Promise<T> {
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(`${toolName}:${toolArgs}`).digest('hex').slice(0, 32);
    const sessionId = options?.sessionId || `session_${Date.now()}`;

    // Pre-check with the gateway
    const preEvent: VantinelEvent = {
      event_type: 'tool_call',
      session_id: sessionId,
      agent_id: this.config.agentId,
      tool_name: toolName,
      tool_args_hash: hash,
      timestamp: Date.now(),
      estimated_cost: options?.estimatedCost,
      trace_id: options?.traceId,
    };

    const decision = await this.sendEvent(preEvent);

    if (decision.decision === 'block') {
      throw new Error(
        `[Vantinel] Tool call blocked: ${toolName} — ${decision.message || 'Policy violation'}`,
      );
    }

    // Execute and time
    const startTime = process.hrtime.bigint();
    try {
      const result = await fn();
      const latencyMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      // Send completion with latency
      const completionEvent: VantinelEvent = {
        ...preEvent,
        latency_ms: latencyMs,
        timestamp: Date.now(),
      };
      await this.sendEvent(completionEvent).catch(() => { });

      return result;
    } catch (err) {
      const latencyMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      // Report error with latency
      const errorEvent: VantinelEvent = {
        ...preEvent,
        event_type: 'tool_error',
        latency_ms: latencyMs,
        timestamp: Date.now(),
        metadata: {
          error_message: err instanceof Error ? err.message : String(err),
        },
      };
      await this.sendEvent(errorEvent).catch(() => { });

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
      const sessionId = options?.sessionId || `session_${Date.now()}`;

      const { createHash } = await import('crypto');
      const hash = createHash('sha256').update(`${toolName}:${argsText}`).digest('hex').slice(0, 32);

      const isStream = body?.stream === true || reqOptions?.stream === true;
      if (isStream) {
        if (!body.stream_options) {
          body.stream_options = { include_usage: true };
        }
      }

      const preEvent: VantinelEvent = {
        event_type: 'tool_call',
        session_id: sessionId,
        agent_id: this.config.agentId,
        tool_name: toolName,
        tool_args_hash: hash,
        timestamp: Date.now(),
        trace_id: options?.traceId,
      };

      const decision = await this.sendEvent(preEvent);
      if (decision.decision === 'block') {
        throw new Error(
          `[Vantinel] Tool call blocked: ${toolName} — ${decision.message || 'Policy violation'}`,
        );
      }

      const startTime = process.hrtime.bigint();
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
              const latencyMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
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
              const completionEvent: VantinelEvent = {
                ...preEvent,
                latency_ms: latencyMs,
                estimated_cost: estimatedCost,
                timestamp: Date.now(),
              };
              self.sendEvent(completionEvent).catch(() => { });
            }
          }
          return wrapper();
        }

        const latencyMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

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

        const completionEvent: VantinelEvent = {
          ...preEvent,
          latency_ms: latencyMs,
          estimated_cost: estimatedCost,
          timestamp: Date.now(),
        };
        await this.sendEvent(completionEvent).catch(() => { });

        return response;
      } catch (err) {
        const latencyMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

        const errorEvent: VantinelEvent = {
          ...preEvent,
          event_type: 'tool_error',
          latency_ms: latencyMs,
          timestamp: Date.now(),
          metadata: {
            error_message: err instanceof Error ? err.message : String(err),
          },
        };
        await this.sendEvent(errorEvent).catch(() => { });
        throw err;
      }
    };

    return openaiClient;
  }

  async flush(): Promise<void> {
    if (this.batchQueue.length === 0) return;
    const batch = this.batchQueue.splice(0, this.batchQueue.length);
    try {
      await this.sendWithRetry(batch);
    } catch {
      // Errors are already logged inside sendWithRetry
    }
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.client.get('/health');
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}

export { estimateCostFromTokens, estimateCostFromText, estimateTokens, MODEL_PRICING };
