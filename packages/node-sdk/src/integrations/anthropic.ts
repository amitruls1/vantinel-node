/**
 * Anthropic SDK integration for Vantinel.
 *
 * Usage:
 *   import Anthropic from '@anthropic-ai/sdk';
 *   import { VantinelClient } from '@vantinel/node-sdk';
 *   import { wrapAnthropic } from '@vantinel/node-sdk/integrations/anthropic';
 *
 *   const client = new VantinelClient({ apiKey: '...', clientId: '...' });
 *   const anthropic = wrapAnthropic(client, new Anthropic());
 *
 *   const response = await anthropic.messages.create({
 *     model: 'claude-sonnet-4-6',
 *     max_tokens: 1024,
 *     messages: [{ role: 'user', content: 'Hello' }],
 *   });
 */

import * as crypto from 'crypto';
import type { VantinelClient } from '../client';
import { estimateCostFromTokens } from '../client';

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicMessage {
  role: string;
  content: unknown;
}

interface AnthropicCreateParams {
  model: string;
  messages: AnthropicMessage[];
  stream?: boolean;
  max_tokens?: number;
  [key: string]: unknown;
}

interface AnthropicResponse {
  usage?: AnthropicUsage;
  stop_reason?: string;
  content?: Array<{ type: string; name?: string }>;
  [key: string]: unknown;
}

interface AnthropicClient {
  messages: {
    create(params: AnthropicCreateParams): Promise<AnthropicResponse>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function buildArgsHash(model: string, messages: AnthropicMessage[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ model, messages_count: messages.length, first_msg: messages[0]?.content }))
    .digest('hex')
    .slice(0, 32);
}

function extractCost(model: string, usage: AnthropicUsage | undefined): number | undefined {
  if (!usage) return undefined;
  const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const outputTokens = usage.output_tokens ?? 0;
  const cachedTokens = usage.cache_read_input_tokens ?? 0;
  return estimateCostFromTokens(model, inputTokens + cachedTokens, outputTokens, cachedTokens);
}

/**
 * Wrap an Anthropic client to auto-monitor all messages.create() calls.
 *
 * @param vantinelClient - VantinelClient instance
 * @param anthropicClient - anthropic.Anthropic() instance
 * @param options - Optional session/agent configuration
 * @returns The patched Anthropic client
 */
export function wrapAnthropic(
  vantinelClient: VantinelClient,
  anthropicClient: AnthropicClient,
  options?: { sessionId?: string; agentId?: string },
): AnthropicClient {
  const originalCreate = anthropicClient.messages.create.bind(anthropicClient.messages);
  const sessionId = options?.sessionId ?? `anthropic_${Date.now()}`;

  anthropicClient.messages.create = async (params: AnthropicCreateParams): Promise<AnthropicResponse> => {
    const { model, messages } = params;
    const toolName = `anthropic_messages_${model}`;
    const argsHash = buildArgsHash(model, messages);

    // Pre-call: send event to get decision
    let decision: string | undefined;
    try {
      const resp = await vantinelClient.sendEvent({
        event_type: 'tool_call',
        tool_name: toolName,
        tool_args_hash: argsHash,
        session_id: sessionId,
        agent_id: options?.agentId,
        timestamp: Date.now(),
        metadata: { model, messages_count: messages.length, framework: 'anthropic' },
      });
      decision = resp?.decision;
    } catch {
      // Fail open: don't block the call if Vantinel is unavailable
    }

    if (decision === 'block') {
      throw new Error(`Vantinel blocked Anthropic call: ${toolName}`);
    }

    const startTime = Date.now();
    const result = await originalCreate(params);
    const latencyMs = Date.now() - startTime;
    const usage = (result as AnthropicResponse).usage;
    const cost = extractCost(model, usage);

    const toolUses = (result as AnthropicResponse).content
      ?.filter((b) => b.type === 'tool_use')
      .map((b) => b.name)
      .filter(Boolean) ?? [];

    // Post-call telemetry (fire-and-forget)
    void vantinelClient.sendEvent({
      event_type: 'tool_result',
      tool_name: toolName,
      tool_args_hash: argsHash,
      session_id: sessionId,
      agent_id: options?.agentId,
      timestamp: Date.now(),
      estimated_cost: cost,
      latency_ms: latencyMs,
      metadata: {
        model,
        messages_count: messages.length,
        framework: 'anthropic',
        stop_reason: (result as AnthropicResponse).stop_reason,
        tool_uses: toolUses,
        input_tokens: usage?.input_tokens,
        output_tokens: usage?.output_tokens,
      },
    }).catch(() => {});

    return result;
  };

  return anthropicClient;
}
