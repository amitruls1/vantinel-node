/**
 * OpenAI Agents SDK integration for Vantinel.
 *
 * Usage:
 *   import { VantinelClient } from '@vantinel/node-sdk';
 *   import { patchOpenAIAgents } from '@vantinel/node-sdk/integrations/openai-agents';
 *
 *   const client = new VantinelClient({ apiKey: '...', clientId: '...' });
 *   patchOpenAIAgents(client);
 *   // Now all @openai/agents traces are automatically monitored
 */

import type { VantinelClient } from '../client';
import { estimateCostFromTokens } from '../client';

interface SpanData {
  name?: string;
  model?: string;
  to_agent?: string;
  from_agent?: string;
  triggered_by?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface Span {
  span_id?: string;
  span_data?: SpanData;
  started_at?: number;
  ended_at?: number;
}

interface Trace {
  trace_id?: string;
  name?: string;
}

interface TracingProcessor {
  onTraceStart(trace: Trace): void | Promise<void>;
  onTraceEnd(trace: Trace): void | Promise<void>;
  onSpanStart(span: Span): void | Promise<void>;
  onSpanEnd(span: Span): void | Promise<void>;
}

/**
 * A TracingProcessor that forwards OpenAI Agents SDK spans to Vantinel.
 */
export class VantinelTracingProcessor implements TracingProcessor {
  private spanStarts = new Map<string, number>();
  private sessionId: string;

  constructor(
    private client: VantinelClient,
    options?: { sessionId?: string; agentId?: string },
  ) {
    this.sessionId = options?.sessionId ?? `agents_${Date.now()}`;
  }

  onTraceStart(_trace: Trace): void {}
  onTraceEnd(_trace: Trace): void {}

  onSpanStart(span: Span): void {
    const id = span.span_id ?? String(Math.random());
    this.spanStarts.set(id, Date.now());
  }

  onSpanEnd(span: Span): void {
    const id = span.span_id ?? '';
    const startMs = this.spanStarts.get(id);
    this.spanStarts.delete(id);
    const latencyMs = startMs != null ? Date.now() - startMs : undefined;

    const spanData = span.span_data;
    const spanType = spanData?.constructor?.name ?? 'UnknownSpan';

    const toolName = this.extractToolName(spanData, spanType);
    if (!toolName) return;

    const metadata: Record<string, unknown> = {
      framework: 'openai-agents',
      span_type: spanType,
      ...(spanData?.name ? { agent_name: spanData.name } : {}),
      ...(spanData?.model ? { model: spanData.model } : {}),
      ...(spanData?.to_agent ? { to_agent: spanData.to_agent } : {}),
      ...(latencyMs != null ? { latency_ms: latencyMs } : {}),
    };

    const estimatedCost = this.extractCost(spanData);

    // Fire-and-forget
    void this.client.sendEvent({
      event_type: 'tool_call',
      tool_name: toolName,
      tool_args_hash: id || '',
      session_id: this.sessionId,
      timestamp: Date.now(),
      estimated_cost: estimatedCost,
      latency_ms: latencyMs,
      metadata,
    }).catch(() => {});
  }

  private extractToolName(spanData: SpanData | undefined, spanType: string): string | null {
    if (!spanData) return null;
    if (spanType === 'AgentSpanData') return `agent_run_${spanData.name ?? 'agent'}`;
    if (spanType === 'FunctionSpanData') return `tool_call_${spanData.name ?? 'function'}`;
    if (spanType === 'GenerationSpanData') return `llm_generation_${spanData.model ?? 'unknown'}`;
    if (spanType === 'HandoffSpanData') return `handoff_to_${spanData.to_agent ?? 'unknown'}`;
    if (spanType === 'GuardrailSpanData') return `guardrail_${spanData.name ?? 'guardrail'}`;
    return null;
  }

  private extractCost(spanData: SpanData | undefined): number | undefined {
    if (!spanData?.usage) return undefined;
    const inputTokens = spanData.usage.input_tokens ?? 0;
    const outputTokens = spanData.usage.output_tokens ?? 0;
    const model = spanData.model ?? 'gpt-4o';
    return estimateCostFromTokens(model, inputTokens, outputTokens);
  }
}

/**
 * Register Vantinel as a tracing processor for the OpenAI Agents SDK.
 *
 * @param client - VantinelClient instance
 * @param options - Optional session/agent configuration
 * @returns The registered VantinelTracingProcessor
 * @throws If @openai/agents is not installed
 */
export function patchOpenAIAgents(
  client: VantinelClient,
  options?: { sessionId?: string; agentId?: string },
): VantinelTracingProcessor {
  let addTracingProcessor: (processor: TracingProcessor) => void;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ addTracingProcessor } = require('@openai/agents'));
  } catch {
    throw new Error(
      'patchOpenAIAgents requires the @openai/agents package. Install with: npm install @openai/agents',
    );
  }

  const processor = new VantinelTracingProcessor(client, options);
  addTracingProcessor(processor);
  return processor;
}
