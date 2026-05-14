---
name: run-agentdesk-subagents
description: Use when the user asks to run, execute, fan out, or implement an AgentDesk task with parallel subagents, including either Codex CLI subagents or Codex App subagents. Prefer the AgentDesk MCP session tool when available and verify the resulting session status.
---

# Run AgentDesk Subagents

Use this skill to execute an existing AgentDesk task with concurrent subagents.

## Choose Launcher

- `codex-cli`: AgentDesk starts Codex CLI subagents itself. Use for automated execution, worktree mode, branch integration, and persistent session logs.
- `codex-app`: AgentDesk prepares a tracked launch plan and prompts. The host Codex App must then call `spawn_agent` for each prompt because the Node MCP server cannot call Codex App host tools directly.

## MCP Workflow

1. Read or create the task first, then identify its `taskId`.
2. Call `start_subagent_session` with:
   - `taskId`
   - `subagentLauncher`: `codex-cli` or `codex-app`
   - `parallelism`: user requested value, defaulting to 6
   - `model`: default `gpt-5.5`
   - `reasoning`: default `xhigh`
3. For `codex-cli`, poll `read_subagent_session` until status is `succeeded` or `failed`.
4. For `codex-app`, use `appLaunchPlan.subagents`:
   - Start up to `parallelism` app subagents with `spawn_agent`.
   - Give each subagent its returned prompt exactly enough to execute its assigned subtask.
   - Do not edit the same files from multiple subagents unless the task plan explicitly separates ownership.
5. Summarize session id, launcher, parallelism, succeeded/failed counts, changed files, and verification.

## CLI Fallback

When MCP is unavailable, use:

```sh
./scripts/ralphctl.sh sessions start <taskId> --project <projectRoot> --parallel <N> --json
./scripts/ralphctl.sh sessions show <sessionId> --project <projectRoot> --json
```

## Guardrails

- Worktree mode supports only `codex-cli`.
- `codex-app` should use `current-branch` analysis/host orchestration unless the user explicitly gives a safe write ownership split.
- Never claim a session has app subagents running just because a launch plan exists; only the Codex App host can actually start them.
