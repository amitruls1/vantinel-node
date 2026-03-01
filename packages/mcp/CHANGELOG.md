# @vantinel/mcp Changelog

## [0.3.0] - 2026-02-26

### Added
- `README.md` — full setup guide for Claude Code, Claude Desktop, and all MCP clients; documents all 14 tools with descriptions and example prompts

## [0.2.0] - 2026-02-26

### Added
- `check_connectivity` tool — verify Vantinel collector is reachable before production deployment
- `get_tool_errors` tool — surface AI tool failure rates and error patterns from captureError() events

### Changed
- `get_forecast` description updated with "Stop the Bleed" messaging — emphasizes predictive budget protection
- `get_shadow_blocks` description updated — clarifies the "prove value before enforcing" adoption pattern
- Server version bumped to 0.2.0

## [0.1.0] - 2025-12-01

### Added
- Initial MCP server release
- Tools: list_projects, get_sessions, get_session_detail, get_metrics, get_alerts, get_anomalies, get_approvals, approve_tool_call, get_policy, update_policy, get_shadow_blocks, get_forecast
