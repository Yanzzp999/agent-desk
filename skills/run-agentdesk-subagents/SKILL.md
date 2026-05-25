---
name: run-agentdesk-subagents
description: "Explicitly specified only: use this skill only when the user writes `$run-agentdesk-subagents` or `run-agentdesk-subagents` by name. Never infer or proactively trigger it from task content, workflow fit, or subagent-related requests alone. When explicitly requested by name, run or coordinate an existing AgentDesk task with parallel Codex CLI or Codex App subagents."
---

# Run AgentDesk Subagents

## Explicit Invocation Only

The user must explicitly specify this skill by writing `$run-agentdesk-subagents` or `run-agentdesk-subagents` by name. Never infer this skill from task content, workflow fit, or subagent-related requests alone.

Use this skill to execute an existing AgentDesk task with concurrent subagents.
Treat configured parallelism as the maximum concurrency limit, not as a required number of subagents to launch. The model may decide how many subagents are useful for the task, and the user may request any concurrency from 1 through the configured maximum.
For validation, QA, smoke-test, or health-check tasks in this AgentDesk workspace, prefer `current-branch` with low parallelism unless you have confirmed the target checkout supports branch-aware worktree completion with `worktreeIntegration=agent-branch` and `pushWorktreeIntegration=false`.

## Concurrency Planning

Before starting a session, review the task's complexity, subtask count, file/module ownership, and likely concurrent-edit conflicts.
Use that review to choose a recommended per-batch subagent count and `parallelism` value within the configured cap instead of always filling every available slot.
Notify the user of the chosen recommendation and the reason for it before or as the session starts.
If the user later chooses a different concurrency value, respect the user-selected value as long as it is within `1..maxParallelism`.

## Choose Launcher

- `codex-cli`: AgentDesk starts Codex CLI subagents itself. Use for automated execution and persistent session logs. Defaults are model `gpt-5.5`, reasoning `xhigh`, service tier `fast`, execution mode `auto`, and parallelism `6`. In this AgentDesk workspace, do not use `auto` or `worktree` for validation tasks unless the session will keep completed work in agent branches and will not push by default.
- `codex-app`: AgentDesk prepares a tracked launch plan and prompts in `current-branch` mode. The host Codex App must then call `spawn_agent` for each prompt because the Node MCP server cannot call Codex App host tools directly.

## MCP Workflow

1. Read or create the task first, then identify its `taskId`.
2. Confirm the checkout is on the repository-designated working branch before starting. In this AgentDesk workspace, use `agentdesk/next` as the base for new work and do not use `master` as the session base.
3. Call `start_subagent_session` with:
   - `taskId`
   - `subagentLauncher`: `codex-cli` or `codex-app`
   - `parallelism`: the recommended or user-selected maximum concurrency, defaulting to 6
   - `model`: default `gpt-5.5`
   - `reasoning`: default `xhigh`
   - `executionMode`: default `auto`; use `current-branch` for `codex-app`; for AgentDesk validation tasks, use `current-branch` unless branch-aware no-push worktree completion has been confirmed
   - For worktree sessions in this repository, pass or verify `baseBranch=agentdesk/next`, `worktreeIntegration=agent-branch`, and `pushWorktreeIntegration=false`
4. Never launch more subagents at once than `parallelism`. Let the model/task plan decide the useful number of subagents and batches within that cap; if the user specifies a concurrency value, it must be between 1 and the configured maximum.
5. For `codex-cli`, rely on `start_subagent_session` to block until status is `succeeded` or `failed` unless you explicitly pass `waitForCompletion: false`.
6. For `codex-app`, use `appLaunchPlan.subagents`:
   - Confirm the MCP result includes `requiresHostLaunch: true`.
   - Treat `prepared_for_app` as "prompt prepared", not as a running or completed app subagent.
   - Start up to `parallelism` app subagents with `spawn_agent`.
   - If the launch plan has more subagents than `parallelism`, launch them in batches of at most `parallelism`.
   - Give each subagent its returned prompt exactly enough to execute its assigned subtask.
   - Do not edit the same files from multiple subagents unless the task plan explicitly separates ownership.
7. Summarize session id, launcher, maximum parallelism, actual launched or prepared subagent count, changed files, and verification. For `codex-app`, report host-side succeeded/failed counts only when the Codex App host returned them; AgentDesk itself keeps `succeededAgents` at `0` for launch-plan preparation.

## CLI Fallback

When MCP is unavailable, use:

```sh
./scripts/verunectl.sh sessions start <taskId> --project <projectRoot> --parallel <N> --json
./scripts/verunectl.sh sessions show <sessionId> --project <projectRoot> --json
```

For Codex App handoff through the CLI fallback, include `--execution-mode current-branch --subagent-launcher codex-app` and then use the returned plan prompts in the Codex App host.

## Guardrails

- Worktree mode supports only `codex-cli`.
- If the current AgentDesk implementation would rebase, fast-forward, merge, or push `master`, do not choose that path after the user has designated another working branch. Use `current-branch` execution from the designated branch or stop and ask for an alternate integration path.
- For this AgentDesk workspace, future work should be based on `agentdesk/next`; never switch to `master`, create work from `master`, or merge/push `master` unless the user explicitly requests that action.
- Worktree mode is acceptable only when the session base branch is the repository-designated branch and completion is branch-aware with no default push. Completed agent branches may be left for the main agent to review and integrate.
- `codex-app` should use `current-branch` analysis/host orchestration unless the user explicitly gives a safe write ownership split.
- Configuration defines the maximum concurrency only; it does not force every run to use that many subagents.
- User-selected concurrency must be in the inclusive range `1..maxParallelism`, and no batch may exceed that cap.
- Never claim a session has app subagents running just because a launch plan exists; only the Codex App host can actually start them.
- Never treat an AgentDesk `succeeded` status for a `codex-app` session as evidence that host-side subagents completed; it only means launch-plan preparation succeeded unless host execution results are separately available.
