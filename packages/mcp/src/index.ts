#!/usr/bin/env node
/**
 * Vantinel MCP Server
 *
 * Exposes Vantinel observability data as MCP tools so Claude Code / Claude Desktop
 * can query your AI agent monitoring data using natural language.
 *
 * Configuration (env vars):
 *   VANTINEL_API_KEY  — required, API key from the Vantinel dashboard
 *   VANTINEL_BASE_URL — optional, defaults to https://app.vantinel.com
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_KEY = process.env.VANTINEL_API_KEY;
const BASE_URL = (process.env.VANTINEL_BASE_URL ?? 'https://app.vantinel.com').replace(/\/$/, '');

if (!API_KEY) {
  process.stderr.write('Error: VANTINEL_API_KEY environment variable is required\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  searchParams?: Record<string, string>
): Promise<unknown> {
  let url = `${BASE_URL}${path}`;
  if (searchParams) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(searchParams).filter(([, v]) => v !== undefined && v !== ''))
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    'X-Vantinel-API-Key': API_KEY!,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vantinel API error ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_projects',
    description: 'List all projects in your Vantinel organization.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_sessions',
    description: 'Get active and recent agent sessions. Optionally filter by project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Filter sessions by project UUID (optional)',
        },
        time_range: {
          type: 'string',
          enum: ['1 hour', '6 hours', '24 hours'],
          description: 'Time range for sessions (default: 1 hour)',
        },
      },
    },
  },
  {
    name: 'get_session_detail',
    description: 'Get detailed information about a single agent session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The session ID to retrieve',
        },
        project_id: {
          type: 'string',
          description: 'Project UUID the session belongs to (optional)',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'get_metrics',
    description:
      'Get aggregated metrics: tool call rates, session costs, latency percentiles. Optionally filter by project and time range.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Filter by project UUID (optional)',
        },
        metric_name: {
          type: 'string',
          description:
            'Specific metric to query, e.g. tool_calls_total, session_cost_total, tool_latency_ms (optional)',
        },
        time_range: {
          type: 'string',
          enum: ['1 hour', '6 hours', '24 hours', '7 days', '30 days'],
          description: 'Time window for metrics (default: 1 hour)',
        },
      },
    },
  },
  {
    name: 'get_alerts',
    description: 'Get recent alerts: zombie loop detections, budget warnings, anomalies, blocked tools, shadow blocks (would-have-blocked events), and tool errors.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Filter by project UUID (optional)',
        },
        severity: {
          type: 'string',
          enum: ['info', 'warning', 'critical'],
          description: 'Filter by severity level (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of alerts to return (default: 50)',
        },
      },
    },
  },
  {
    name: 'get_anomalies',
    description: 'Get the anomaly detection feed: latency spikes, frequency surges, cost outliers.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Filter by project UUID (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of anomalies to return (default: 50)',
        },
      },
    },
  },
  {
    name: 'get_approvals',
    description: 'Get pending tool approval requests that require human-in-the-loop review.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Filter by project UUID (optional)',
        },
        status: {
          type: 'string',
          enum: ['pending', 'approved', 'denied'],
          description: 'Filter by approval status (default: pending)',
        },
      },
    },
  },
  {
    name: 'approve_tool_call',
    description: 'Approve or deny a pending tool call that requires human approval.',
    inputSchema: {
      type: 'object',
      properties: {
        approval_id: {
          type: 'string',
          description: 'The approval request ID',
        },
        decision: {
          type: 'string',
          enum: ['approved', 'denied'],
          description: 'Whether to approve or deny the tool call',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for the decision',
        },
      },
      required: ['approval_id', 'decision'],
    },
  },
  {
    name: 'get_policy',
    description: 'Get the current policy configuration for a project (budget caps, blocked tools, approval rules).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project UUID to retrieve policy for (optional — uses default project if omitted)',
        },
      },
    },
  },
  {
    name: 'update_policy',
    description:
      'Update policy settings for a project: budget cap, max tool calls, blocked tools, approval requirements.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project UUID to update policy for',
        },
        budget_cap: {
          type: 'number',
          description: 'Maximum budget in USD per session',
        },
        max_tool_calls_per_session: {
          type: 'number',
          description: 'Maximum number of tool calls allowed per session',
        },
        blocked_tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of tool names to hard-block (e.g. ["execute_code", "send_email"])',
        },
        require_approval: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns for tools requiring human approval (e.g. ["delete_*", "*payment*"])',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_shadow_blocks',
    description: 'Prove value before enforcing — get Shadow Mode events. These are tool calls Vantinel would have blocked but allowed through (no disruption to your agents). Each event shows the estimated cost savings. Perfect for showing stakeholders: "Vantinel would have blocked a Zombie Loop here. You just saved $14.20." Run in shadow mode first, enforce when ready.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Filter by project UUID (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of shadow blocks to return (default: 50)',
        },
      },
    },
  },
  {
    name: 'get_forecast',
    description: '🛑 Stop the Bleed — Get budget burn rate forecast. Predicts when the budget will be exhausted based on current spend velocity. Alerts you minutes BEFORE the budget runs out, not after. Use this to identify and stop runaway agents before they cost thousands of dollars.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project UUID to forecast for (optional)',
        },
        session_id: {
          type: 'string',
          description: 'Forecast for a specific session (optional)',
        },
      },
    },
  },
  {
    name: 'check_connectivity',
    description: 'Check if the Vantinel collector is reachable and return its health status and latency. Use this to verify your SDK integration is working before going to production.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project UUID to check connectivity for (optional)',
        },
      },
    },
  },
  {
    name: 'get_tool_errors',
    description: 'Get recent tool error events captured via captureError() in the SDK. Shows failure rates, error types, and retry patterns per tool. Essential for AI reliability monitoring.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Filter by project UUID (optional)',
        },
        tool_name: {
          type: 'string',
          description: 'Filter by tool name (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of error events to return (default: 50)',
        },
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  const str = (v: unknown) => (v != null ? String(v) : undefined);

  switch (name) {
    case 'list_projects': {
      const data = await apiRequest('GET', '/api/projects');
      return JSON.stringify(data, null, 2);
    }

    case 'get_sessions': {
      const data = await apiRequest('GET', '/api/sessions', undefined, {
        project_id: str(args.project_id) ?? '',
        time_range: str(args.time_range) ?? '',
      });
      return JSON.stringify(data, null, 2);
    }

    case 'get_session_detail': {
      const sessionId = str(args.session_id);
      if (!sessionId) throw new Error('session_id is required');
      const params: Record<string, string> = {};
      if (args.project_id) params.project_id = str(args.project_id)!;
      const data = await apiRequest('GET', `/api/sessions/${encodeURIComponent(sessionId)}`, undefined, params);
      return JSON.stringify(data, null, 2);
    }

    case 'get_metrics': {
      const data = await apiRequest('GET', '/api/metrics', undefined, {
        project_id: str(args.project_id) ?? '',
        metric_name: str(args.metric_name) ?? '',
        time_range: str(args.time_range) ?? '',
      });
      return JSON.stringify(data, null, 2);
    }

    case 'get_alerts': {
      const data = await apiRequest('GET', '/api/alerts', undefined, {
        project_id: str(args.project_id) ?? '',
        severity: str(args.severity) ?? '',
        limit: str(args.limit) ?? '',
      });
      return JSON.stringify(data, null, 2);
    }

    case 'get_anomalies': {
      const data = await apiRequest('GET', '/api/anomalies', undefined, {
        project_id: str(args.project_id) ?? '',
        limit: str(args.limit) ?? '',
      });
      return JSON.stringify(data, null, 2);
    }

    case 'get_approvals': {
      const data = await apiRequest('GET', '/api/approvals', undefined, {
        project_id: str(args.project_id) ?? '',
        status: str(args.status) ?? 'pending',
      });
      return JSON.stringify(data, null, 2);
    }

    case 'approve_tool_call': {
      const approvalId = str(args.approval_id);
      if (!approvalId) throw new Error('approval_id is required');
      const decision = str(args.decision);
      if (!decision) throw new Error('decision is required');
      const data = await apiRequest('POST', '/api/approvals', {
        approval_id: approvalId,
        decision,
        reason: args.reason ?? null,
      });
      return JSON.stringify(data, null, 2);
    }

    case 'get_policy': {
      const data = await apiRequest('GET', '/api/policies', undefined, {
        project_id: str(args.project_id) ?? '',
      });
      return JSON.stringify(data, null, 2);
    }

    case 'update_policy': {
      const projectId = str(args.project_id);
      if (!projectId) throw new Error('project_id is required');
      const body: Record<string, unknown> = { project_id: projectId };
      if (args.budget_cap !== undefined) body.budget_cap = args.budget_cap;
      if (args.max_tool_calls_per_session !== undefined)
        body.max_tool_calls_per_session = args.max_tool_calls_per_session;
      if (args.blocked_tools !== undefined) body.blocked_tools = args.blocked_tools;
      if (args.require_approval !== undefined) body.require_approval = args.require_approval;
      const data = await apiRequest('PUT', '/api/policies', body);
      return JSON.stringify(data, null, 2);
    }

    case 'get_shadow_blocks': {
      const data = await apiRequest('GET', '/api/alerts', undefined, {
        project_id: str(args.project_id) ?? '',
        severity: 'info',
        limit: str(args.limit) ?? '50',
      });
      // Filter to shadow_block events only - the gateway stores them as event_type='shadow_block'
      // The /api/alerts endpoint returns all events; we filter client-side
      if (Array.isArray(data)) {
        const shadows = (data as any[]).filter((e: any) => e.event_type === 'shadow_block');
        return JSON.stringify(shadows, null, 2);
      }
      return JSON.stringify(data, null, 2);
    }

    case 'get_forecast': {
      const data = await apiRequest('GET', '/api/forecast', undefined, {
        project_id: str(args.project_id) ?? '',
        session_id: str(args.session_id) ?? '',
      });
      return JSON.stringify(data, null, 2);
    }

    case 'check_connectivity': {
      const params: Record<string, string> = {};
      if (args.project_id) params.project_id = str(args.project_id)!;
      const data = await apiRequest('GET', '/health', undefined, params);
      return JSON.stringify(data, null, 2);
    }

    case 'get_tool_errors': {
      const params: Record<string, string> = {
        project_id: str(args.project_id) ?? '',
        limit: str(args.limit) ?? '50',
      };
      if (args.tool_name) params.tool_name = str(args.tool_name)!;
      const data = await apiRequest('GET', '/api/alerts', undefined, {
        ...params,
        event_type: 'tool_error',
      });
      return JSON.stringify(data, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'vantinel', version: '0.3.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, (args ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Vantinel MCP server running (stdio)\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
