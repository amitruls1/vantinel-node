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
      .update(toolName + argsStr)
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

  monitor<T>(
    toolName: string,
    fn: T,
    options?: {
      traceId?: string;
      skip?: boolean;
      costCalculator?: (result: any) => { estimated_cost: number; metadata?: Record<string, unknown> };
    },
  ): T {
    return (async (...args: any[]) => {
      if (options?.skip) {
        return (fn as any)(...args);
      }

      const argsHash = this.hashArgs(toolName, args);
      const start = Date.now();

      const preEvent = {
        session_id: this.sessionId,
        agent_id: this.config.agentId,
        tool_name: toolName,
        tool_args_hash: argsHash,
        timestamp: Date.now(),
        ...(options?.traceId ? { trace_id: options.traceId } : {}),
        metadata: this.mergeMetadata(),
      };

      const rawDecision = await this.client.sendEvent(preEvent);
      const decision = await this.applyDecision(rawDecision, toolName);

      if (decision.decision === 'block') {
        throw new Error(`[Vantinel] Tool blocked: ${decision.message || 'Policy violation'}`);
      }

      if (decision.decision === 'require_approval') {
        console.warn('[Vantinel] Approval required but not implemented in SDK yet. Allowing.');
      }

      const result = await (fn as any)(...args);
      const latencyMs = Date.now() - start;

      // Send follow-up latency event
      let estimatedCost: number | undefined;
      let extraMeta: Record<string, unknown> | undefined;

      if (options?.costCalculator) {
        const calc = options.costCalculator(result);
        estimatedCost = calc.estimated_cost;
        extraMeta = calc.metadata;
      }

      await this.client.sendEvent({
        session_id: this.sessionId,
        agent_id: this.config.agentId,
        tool_name: toolName,
        tool_args_hash: argsHash,
        timestamp: Date.now(),
        latency_ms: latencyMs,
        ...(estimatedCost !== undefined ? { estimated_cost: estimatedCost } : {}),
        ...(options?.traceId ? { trace_id: options.traceId } : {}),
        event_type: 'tool_result',
        metadata: this.mergeMetadata(extraMeta),
      });

      return result;
    }) as any;
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

  startTrace(): string {
    return uuidv4();
  }

  wrapOpenAI(openaiClient: any): any {
    const self = this;
    const handler = {
      get: (target: any, prop: string) => {
        if (prop === 'chat') {
          return {
            completions: {
              create: async (params: any) => {
                const argsHash = crypto
                  .createHash('sha256')
                  .update(JSON.stringify(params))
                  .digest('hex')
                  .slice(0, 32);

                const rawDecision = await self.client.sendEvent({
                  session_id: self.sessionId,
                  agent_id: self.config.agentId,
                  tool_name: 'openai_chat_completion',
                  tool_args_hash: argsHash,
                  timestamp: Date.now(),
                  metadata: self.mergeMetadata({ model: params.model }),
                });

                const decision = await self.applyDecision(
                  rawDecision,
                  'openai_chat_completion',
                );

                if (decision.decision === 'block') {
                  throw new Error(`[Vantinel] Blocked: ${decision.message}`);
                }

                const start = Date.now();
                const response = await target.chat.completions.create(params);
                const latencyMs = Date.now() - start;

                // Fire-and-forget latency event
                self.client
                  .sendEvent({
                    session_id: self.sessionId,
                    agent_id: self.config.agentId,
                    tool_name: 'openai_chat_completion',
                    tool_args_hash: argsHash,
                    timestamp: Date.now(),
                    latency_ms: latencyMs,
                    event_type: 'tool_result',
                    metadata: self.mergeMetadata({ model: params.model }),
                  })
                  .catch((err: Error) => {
                    console.warn('[Vantinel] Failed to send latency event:', err.message);
                  });

                return response;
              },
            },
          };
        }
        return target[prop];
      },
    };
    return new Proxy(openaiClient, handler);
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

    const wrapMethod = (methodName: string) => async (...args: any[]) => {
      const argsHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(args))
        .digest('hex')
        .slice(0, 32);
      const toolLabel = `langchain_${chainName}_${methodName}`;

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

      const start = Date.now();
      const result = await chain[methodName](...args);
      const latencyMs = Date.now() - start;

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
