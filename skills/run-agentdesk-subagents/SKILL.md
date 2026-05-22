---
name: run-agentdesk-subagents
description: "Explicit-use only: use this skill only when the user explicitly names `$run-agentdesk-subagents` or `run-agentdesk-subagents`, or otherwise unambiguously asks to use this specific skill. Do not proactively trigger it from task content alone. When explicitly requested, run or coordinate an existing AgentDesk task with parallel Codex CLI or Codex App subagents."
---

# Run AgentDesk Subagents

## Explicit Invocation Only

Do not use this skill unless the user explicitly names `$run-agentdesk-subagents` or `run-agentdesk-subagents`, or otherwise unambiguously asks to use this specific skill. Do not trigger it from task content alone.

Use this skill to execute an existing AgentDesk task with concurrent subagents.
Treat configured parallelism as the maximum concurrency limit, not as a required number of subagents to launch. The model may decide how many subagents are useful for the task, and the user may request any concurrency from 1 through the configured maximum.

## Concurrency Planning

Before starting a session, review the task's complexity, subtask count, file/module ownership, and likely concurrent-edit conflicts.
Use that review to choose a recommended per-batch subagent count and `parallelism` value within the configured cap instead of always filling every available slot.
Notify the user of the chosen recommendation and the reason for it before or as the session starts.
If the user later chooses a different concurrency value, respect the user-selected value as long as it is within `1..maxParallelism`.

## Choose Launcher

- `codex-cli`: AgentDesk starts Codex CLI subagents itself. Use for automated execution, worktree mode, branch integration, and persistent session logs.
- `codex-app`: AgentDesk prepares a tracked launch plan and prompts. The host Codex App must then call `spawn_agent` for each prompt because the Node MCP server cannot call Codex App host tools directly.

## MCP Workflow

1. Read or create the task first, then identify its `taskId`.
2. Call `start_subagent_session` with:
   - `taskId`
   - `subagentLauncher`: `codex-cli` or `codex-app`
   - `parallelism`: the recommended or user-selected maximum concurrency, defaulting to 6
   - `model`: default `gpt-5.5`
   - `reasoning`: default `xhigh`
3. Never launch more subagents at once than `parallelism`. Let the model/task plan decide the useful number of subagents and batches within that cap; if the user specifies a concurrency value, it must be between 1 and the configured maximum.
4. For `codex-cli`, rely on `start_subagent_session` to block until status is `succeeded` or `failed` unless you explicitly pass `waitForCompletion: false`.
5. For `codex-app`, use `appLaunchPlan.subagents`:
   - Start up to `parallelism` app subagents with `spawn_agent`.
   - If the launch plan has more subagents than `parallelism`, launch them in batches of at most `parallelism`.
   - Give each subagent its returned prompt exactly enough to execute its assigned subtask.
   - Do not edit the same files from multiple subagents unless the task plan explicitly separates ownership.
6. Summarize session id, launcher, maximum parallelism, actual launched subagent count, succeeded/failed counts, changed files, and verification.

## CLI Fallback

When MCP is unavailable, use:

```sh
./scripts/verunectl.sh sessions start <taskId> --project <projectRoot> --parallel <N> --json
./scripts/verunectl.sh sessions show <sessionId> --project <projectRoot> --json
```

## Guardrails

- Worktree mode supports only `codex-cli`.
- `codex-app` should use `current-branch` analysis/host orchestration unless the user explicitly gives a safe write ownership split.
- Configuration defines the maximum concurrency only; it does not force every run to use that many subagents.
- User-selected concurrency must be in the inclusive range `1..maxParallelism`, and no batch may exceed that cap.
- Never claim a session has app subagents running just because a launch plan exists; only the Codex App host can actually start them.
