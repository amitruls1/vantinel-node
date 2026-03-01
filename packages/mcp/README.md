# @vantinel/mcp

MCP server that exposes your [Vantinel](https://vantinel.ai) AI agent monitoring data as tools for Claude Code, Claude Desktop, and any MCP-compatible client.

Ask your AI assistant questions like:
- *"Are any of my agents in a zombie loop right now?"*
- *"How much has session sess_abc123 spent so far?"*
- *"Block the `execute_code` tool for project X"*
- *"Show me the last 10 anomalies"*

## Installation

```bash
npm install -g @vantinel/mcp
```

## Setup

### Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json` or via `/mcp`):

```json
{
  "mcpServers": {
    "vantinel": {
      "command": "npx",
      "args": ["-y", "@vantinel/mcp"],
      "env": {
        "VANTINEL_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vantinel": {
      "command": "npx",
      "args": ["-y", "@vantinel/mcp"],
      "env": {
        "VANTINEL_API_KEY": "your-api-key",
        "VANTINEL_BASE_URL": "https://app.vantinel.com"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VANTINEL_API_KEY` | Yes | Your Vantinel API key (from dashboard → Settings → API Keys) |
| `VANTINEL_BASE_URL` | No | Defaults to `https://app.vantinel.com` |

## Available Tools

### Observability

| Tool | Description |
|---|---|
| `list_projects` | List all projects in your Vantinel organization |
| `get_sessions` | Get active and recent agent sessions, filterable by project and time range |
| `get_session_detail` | Deep-dive into a single session: cost, call count, decisions |
| `get_metrics` | Aggregated metrics: tool call rates, costs, latency percentiles |
| `get_alerts` | Recent alerts: zombie loops, budget warnings, anomalies, blocked tools |
| `get_anomalies` | Anomaly detection feed: latency spikes, frequency surges, cost outliers |
| `get_tool_errors` | Tool failure events captured via `captureError()` — rates, types, retry patterns |
| `check_connectivity` | Verify your Vantinel collector is reachable from the MCP server |

### Guardrails

| Tool | Description |
|---|---|
| `get_approvals` | List tool calls awaiting human approval |
| `approve_tool_call` | Approve or deny a pending tool call with optional reason |
| `get_policy` | View current policy: budget caps, blocked tools, approval rules |
| `update_policy` | Update policy: set budget caps, block tools, require approval for patterns |

### Budget Intelligence

| Tool | Description |
|---|---|
| `get_forecast` | Predict when a session/project will exhaust its budget based on current burn rate — alerts you *before* budget runs out |
| `get_shadow_blocks` | Tool calls Vantinel *would have* blocked in shadow mode — use to prove value before enabling enforcement |

## Example Usage

Once configured, you can ask Claude natural-language questions:

```
"Check if any sessions are in a zombie loop right now"

"What's the current burn rate for project X? Will it exceed budget?"

"Block the execute_code tool for my production project"

"Approve the pending delete_users tool call — it was authorized by the user"

"Show me all anomalies from the last 24 hours"
```

## License

MIT © Vantinel AI
