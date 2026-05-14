#!/usr/bin/env sh
set -eu

PACKAGE="${AGENT_DESK_NPM_PACKAGE:-@pavee/agent-desk}"
SERVER_NAME="${AGENT_DESK_MCP_NAME:-agent-desk}"
PROJECT_ROOT="${1:-${AGENT_DESK_PROJECT_ROOT:-}}"

if ! command -v node >/dev/null 2>&1; then
  echo "AgentDesk requires Node.js 22.12 or newer." >&2
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is required. Install Codex first, then rerun this script." >&2
  exit 1
fi

if [ -n "$PROJECT_ROOT" ]; then
  codex mcp add "$SERVER_NAME" \
    --env "AGENT_DESK_PROJECT_ROOT=$PROJECT_ROOT" \
    -- npx -y --package "$PACKAGE" agent-desk-mcp
else
  codex mcp add "$SERVER_NAME" \
    -- npx -y --package "$PACKAGE" agent-desk-mcp
fi

echo "Installed AgentDesk MCP as '$SERVER_NAME'."
echo "Verify with: codex mcp get $SERVER_NAME"
