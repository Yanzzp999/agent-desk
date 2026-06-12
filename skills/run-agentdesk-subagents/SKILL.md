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

## Choose Launcher (Default to Internal Host-Direct)

AgentDesk now defaults to internal subagent launch for Codex / Claude / Grok hosts (no external `codex exec` CLI fanout). Worktree isolation still requires `codex-cli` (external).

- `codex-cli`: AgentDesk starts Codex CLI subagents itself (external processes). Use only when you need AgentDesk to own the launches + full logs. Worktree mode forces this. Defaults are model `gpt-5.5`, reasoning `xhigh`, service tier `fast`, execution mode `auto`, and parallelism `6`.
- `codex-app`: (Codex host internal) AgentDesk prepares tracked launch plan + per-subagent prompt snapshots in `current-branch` mode. Codex App host calls its native `spawn_agent` (or equivalent internal). Use for Codex.
- `claude-direct`: (Claude host internal) Same prep + record flow; Claude uses its native subagent dispatch on the prepared prompts.
- `grok-direct` (or `direct`): (Grok Build host internal) Same; Grok uses its internal subagent mechanism.

When the calling AI is codex/claude/grok, default to the matching *-direct / codex-app launcher + current-branch (or let auto choose current for low-conflict tasks). This is now the preferred path over cli for monitoring and orchestration via AgentDesk task/session state.

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
5. For `codex-cli`, rely on `start_subagent_session` to wait up to 5 minutes for status `succeeded` or `failed` unless you explicitly pass `waitForCompletion: false`. If the result has `waitTimedOut: true` or a non-terminal status, use `read_subagent_session` to continue monitoring the existing session instead of starting a duplicate. Pass `waitTimeoutMs` only when the workflow needs a different MCP wait window.
6. For host-direct launchers (`codex-app`, `claude-direct`, `grok-direct`, `direct`):
   - Confirm `requiresHostLaunch: true` (and `appLaunchPlan` / `hostLaunchPlan` style fields).
   - `prepared_for_app` (or equivalent) means prompt+context ready for host to internally spawn its subagent; AgentDesk has not run anything yet.
   - Use host's native subagent launch (spawn_agent for codex, equivalent for claude/grok) with the exact prompt from the plan. Respect `parallelism` for batching.
   - File ownership: follow the subtask titles and any `<!-- ad:parallel=1 -->` hints; avoid concurrent edits on same paths across subagents.
   - **Monitoring & completion (expanded)**: After the host subagent finishes its work (you see its output/changes in the main session), you MUST call `record_codex_app_subagent_result` (works for all host-direct launchers) with `agentId`, `status` ("succeeded"/"failed"), `report` (summary/tests_run/risks/notes) + optional changedFiles/codex* resume info. This advances AgentDesk session counts, syncs checklist status in task.md, persists memory, and only then marks the overall session terminal. Poll with `read_subagent_session` / `list_subagent_sessions` between host launches and after records to monitor progress centrally.
7. Use `list_subagent_sessions` + `read_subagent_session` (with appLaunchPlan) + `read_subagent_logs` for ongoing monitoring of both cli and host-direct sessions. For host-direct, the "monitoring" lives in the combination of host scrollback + AgentDesk session state updated via record calls.
8. Summarize session id, launcher (note whether internal host-direct), max parallelism, actual counts, changed files, verification. Host-direct succeeded/failed only count after record_ calls have fed results back into AgentDesk.

## CLI Fallback

When MCP is unavailable, use:

```sh
./scripts/verunectl.sh sessions start <taskId> --project <projectRoot> --parallel <N> --subagent-launcher codex-app --json
./scripts/verunectl.sh sessions show <sessionId> --project <projectRoot> --json
```

For internal host-direct handoff (codex/claude/grok), include `--execution-mode current-branch --subagent-launcher codex-app` (or claude-direct/grok-direct) and use the returned appLaunchPlan prompts + record results back (the record tool is also exposed via MCP; for pure CLI you may drive via the control plane worker or manual state). Prefer MCP + skills for full monitoring.

## Guardrails

- Worktree mode supports only `codex-cli`.
- Host-direct internal (codex-app / claude-direct / grok-direct) must use current-branch (or auto that picks it); the host AI owns the actual subagent spawning.
- If the current AgentDesk implementation would rebase, fast-forward, merge, or push `master`, do not choose that path after the user has designated another working branch. Use `current-branch` execution from the designated branch or stop and ask for an alternate integration path.
- For this AgentDesk workspace, future work should be based on `agentdesk/next`; never switch to `master`, create work from `master`, or merge/push `master` unless the user explicitly requests that action.
- Worktree mode is acceptable only when the session base branch is the repository-designated branch and completion is branch-aware with no default push. Completed agent branches may be left for the main agent to review and integrate.
- Host-direct launchers (`codex-app` etc.) should use `current-branch` + host orchestration. Expand monitoring by always recording results back so central AgentDesk session/task state reflects reality for codex/claude/grok runs.
- Configuration defines the maximum concurrency only; it does not force every run to use that many subagents.
- User-selected concurrency must be in the inclusive range `1..maxParallelism`, and no batch may exceed that cap.
- Never claim a session has app subagents running just because a launch plan exists; only the Codex App host can actually start them.
- Never treat launch-plan preparation as evidence that host-side subagents completed. A `codex-app` session reaches `succeeded` only after host results are recorded back into AgentDesk.
