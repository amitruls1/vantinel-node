import { VantinelClient, VantinelConfig, VantinelDecision } from './client';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

export class VantinelMonitor {
  private client: VantinelClient;
  private sessionId: string;
  private config: VantinelConfig;
  private globalMetadata: Record<string, unknown>;
  private static instance: VantinelMonitor | null = null;

  constructor(config: VantinelConfig = {}) {
    this.config = {
      apiKey: process.env.VANTINEL_API_KEY,
      clientId: process.env.VANTINEL_CLIENT_ID,
      collectorUrl: process.env.VANTINEL_COLLECTOR_URL || 'http://localhost:8000',
      agentId: process.env.VANTINEL_AGENT_ID || 'default-agent',
      ...config,
      dryRun: process.env.VANTINEL_DRY_RUN === 'true' || config.dryRun,
      shadowMode: process.env.VANTINEL_SHADOW_MODE === 'true' || config.shadowMode,
    };

    if (!this.config.apiKey) {
      console.warn('[Vantinel] No API Key provided. Monitoring disabled.');
    }

    this.globalMetadata = {};
    this.client = new VantinelClient(this.config);
    this.sessionId = uuidv4();
  }

  static getSingleton(config?: VantinelConfig): VantinelMonitor {
    if (!VantinelMonitor.instance) {
      VantinelMonitor.instance = new VantinelMonitor(config ?? {});
    }
    return VantinelMonitor.instance;
  }

  setGlobalMetadata(metadata: Record<string, unknown>): void {
    this.globalMetadata = { ...this.globalMetadata, ...metadata };
  }

  private mergeMetadata(
    extra?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const merged = { ...this.globalMetadata, ...(extra ?? {}) };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private hashArgs(toolName: string, args: unknown): string {
    const argsStr = JSON.stringify(args);
    return crypto
      .createHash('sha256')
      .update(`${toolName}:${argsStr}`)
      .digest('hex')
      .slice(0, 32);
  }

  private async applyDecision(
    decision: VantinelDecision,
    toolName: string,
    estimatedCost?: number,
  ): Promise<VantinelDecision> {
    if (this.config.shadowMode) {
      if (decision.decision === 'block' || decision.decision === 'require_approval') {
        const costStr =
          estimatedCost !== undefined ? `$${estimatedCost.toFixed(2)}` : 'unknown';
        const reason = decision.decision === 'block' ? 'Policy Violation' : 'Approval Required';
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
          }).catch(() => {}); // fire-and-forget — never block the agent
        }
        return { ...decision, decision: 'allow' };
      }
    }
    return decision;
  }

  monitor<A extends unknown[], R>(
    toolName: string,
    fn: (...args: A) => R | Promise<R>,
    options?: {
      traceId?: string;
      skip?: boolean;
      costCalculator?: (result: Awaited<R>) => { estimated_cost: number; metadata?: Record<string, unknown> };
    },
  ): (...args: A) => Promise<Awaited<R>> {
    const self = this;
    return async (...args: A): Promise<Awaited<R>> => {
      if (options?.skip) {
        return await fn(...args) as Awaited<R>;
      }

      const argsHash = self.hashArgs(toolName, args);
      const start = Date.now();

      const preEvent = {
        session_id: self.sessionId,
        agent_id: self.config.agentId,
        tool_name: toolName,
        tool_args_hash: argsHash,
        timestamp: Date.now(),
        ...(options?.traceId ? { trace_id: options.traceId } : {}),
        metadata: self.mergeMetadata(),
      };

      const rawDecision = await self.client.sendEvent(preEvent);
      const decision = await self.applyDecision(rawDecision, toolName);

      if (decision.decision === 'block') {
        throw new Error(`[Vantinel] Tool blocked: ${decision.message || 'Policy violation'}`);
      }

      if (decision.decision === 'require_approval') {
        console.warn('[Vantinel] Approval required but not implemented in SDK yet. Allowing.');
      }

      try {
        const result = await fn(...args) as Awaited<R>;
        const latencyMs = Date.now() - start;

        let estimatedCost: number | undefined;
        let extraMeta: Record<string, unknown> | undefined;

        if (options?.costCalculator) {
          const calc = options.costCalculator(result);
          estimatedCost = calc.estimated_cost;
          extraMeta = calc.metadata;
        }

        self.client.sendEvent({
          session_id: self.sessionId,
          agent_id: self.config.agentId,
          tool_name: toolName,
          tool_args_hash: argsHash,
          timestamp: Date.now(),
          latency_ms: latencyMs,
          ...(estimatedCost !== undefined ? { estimated_cost: estimatedCost } : {}),
          ...(options?.traceId ? { trace_id: options.traceId } : {}),
          event_type: 'tool_result',
          metadata: self.mergeMetadata(extraMeta),
        }).catch(() => {});

        return result;
      } catch (err) {
        await self.captureError(toolName, err instanceof Error ? err : new Error(String(err))).catch(() => {});
        throw err;
      }
    };
  }

  async captureError(
    toolName: string,
    error: Error,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.client.sendEvent({
      session_id: this.sessionId,
      agent_id: this.config.agentId,
      tool_name: toolName,
      tool_args_hash: crypto
        .createHash('sha256')
        .update(toolName + error.message)
        .digest('hex')
        .slice(0, 32),
      timestamp: Date.now(),
      event_type: 'tool_error',
      metadata: this.mergeMetadata({
        error_message: error.message,
        error_stack: error.stack,
        ...(metadata ?? {}),
      }),
    });
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    return this.client.ping();
  }

  async flush(): Promise<void> {
    return this.client.flush();
  }

  async destroy(): Promise<void> {
    return this.client.destroy();
  }

  startTrace(): string {
    return uuidv4();
  }

  wrapOpenAI(openaiClient: any): any {
    if (!openaiClient?.chat?.completions?.create) {
      console.warn('[Vantinel] Provided client does not look like an OpenAI client.');
      return openaiClient;
    }

    const self = this;
    const originalCreate = openaiClient.chat.completions.create.bind(openaiClient.chat.completions);

    openaiClient.chat.completions.create = async (params: any, reqOptions?: any) => {
      const toolName = 'openai_chat';
      const argsHash = self.hashArgs(toolName, params);

      const rawDecision = await self.client.sendEvent({
        session_id: self.sessionId,
        agent_id: self.config.agentId,
        tool_name: toolName,
        tool_args_hash: argsHash,
        timestamp: Date.now(),
        metadata: self.mergeMetadata({ model: params.model }),
      });

      const decision = await self.applyDecision(rawDecision, toolName);

      if (decision.decision === 'block') {
        throw new Error(`[Vantinel] Blocked: ${decision.message}`);
      }

      const start = Date.now();
      const response = await originalCreate(params, reqOptions);
      const latencyMs = Date.now() - start;

      self.client.sendEvent({
        session_id: self.sessionId,
        agent_id: self.config.agentId,
        tool_name: toolName,
        tool_args_hash: argsHash,
        timestamp: Date.now(),
        latency_ms: latencyMs,
        event_type: 'tool_result',
        metadata: self.mergeMetadata({ model: params.model }),
      }).catch(() => {});

      return response;
    };

    return openaiClient;
  }

  /**
   * Wrap any LangChain chain (RunnableSequence, LLMChain, etc.) for zero-config monitoring.
   *
   * ```ts
   * const chain = prompt.pipe(llm).pipe(parser);
   * const monitored = monitor.wrapLangChain(chain);
   * const result = await monitored.invoke({ question: 'What is AI?' });
   * ```
   */
  wrapLangChain(chain: any): any {
    const self = this;
    const chainName = chain.constructor?.name ?? 'chain';

    const sendLatencyEvent = (toolLabel: string, argsHash: string, latencyMs: number) => {
      self.client
        .sendEvent({
          session_id: self.sessionId,
          agent_id: self.config.agentId,
          tool_name: toolLabel,
          tool_args_hash: argsHash,
          timestamp: Date.now(),
          latency_ms: latencyMs,
          event_type: 'tool_result',
          metadata: self.mergeMetadata(),
        })
        .catch((err: Error) => {
          console.warn('[Vantinel] Failed to send latency event:', err.message);
        });
    };

    const preCheck = async (toolLabel: string, argsHash: string) => {
      const rawDecision = await self.client.sendEvent({
        session_id: self.sessionId,
        agent_id: self.config.agentId,
        tool_name: toolLabel,
        tool_args_hash: argsHash,
        timestamp: Date.now(),
        metadata: self.mergeMetadata(),
      });

      const decision = await self.applyDecision(rawDecision, toolLabel);

      if (decision.decision === 'block') {
        throw new Error(`[Vantinel] Blocked: ${decision.message || 'Policy violation'}`);
      }
    };

    const wrapMethod = (methodName: string) => async (...args: any[]) => {
      const argsHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(args))
        .digest('hex')
        .slice(0, 32);
      const toolLabel = `langchain_${chainName}_${methodName}`;

      await preCheck(toolLabel, argsHash);

      const start = Date.now();

      if (methodName === 'stream') {
        const stream = await chain[methodName](...args);
        // Wrap the async iterator to measure total stream duration
        async function* wrappedStream() {
          try {
            for await (const chunk of stream) {
              yield chunk;
            }
          } finally {
            const latencyMs = Date.now() - start;
            sendLatencyEvent(toolLabel, argsHash, latencyMs);
          }
        }
        return wrappedStream();
      }

      const result = await chain[methodName](...args);
      const latencyMs = Date.now() - start;
      sendLatencyEvent(toolLabel, argsHash, latencyMs);

      return result;
    };

    return new Proxy(chain, {
      get(target: any, prop: string) {
        if (prop === 'invoke' || prop === 'call' || prop === 'run' || prop === 'stream') {
          return wrapMethod(prop);
        }
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  }
}
