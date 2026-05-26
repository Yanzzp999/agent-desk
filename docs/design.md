# AgentDesk Runtime Design

[中文设计说明](design.zh-CN.md)

This page describes runtime behavior that is summarized only briefly in the README.

## Task Generation

`create_agentdesk_task` runs `codex exec` with model `gpt-5.5`, reasoning `xhigh`, and service tier `fast`. It writes markdown only to `task.md`, stores prompt/stdout/stderr artifacts in the task directory, and marks the task `ready` after executable checkbox subtasks are parsed.

If a similar task already exists, creation returns candidate tasks by default so the caller can continue an existing task or explicitly rebuild a fresh one.

## Session Execution

`start_subagent_session` parses subtasks from `task.md` and creates one agent entry per subtask. Defaults are model `gpt-5.5`, reasoning `xhigh`, service tier `fast`, execution mode `auto`, maximum parallelism `6`, and launch batch size `6`.

In `auto` mode, AgentDesk uses the current checkout for single-task, serial, or clearly non-conflicting work. It uses isolated git worktrees when parallel work lacks enough non-conflict evidence or when `worktree` is requested. Worktree mode currently supports `codex-cli` only.

Each agent gets `task.snapshot.md`, `memory.snapshot.md`, `prompt.md`, stdout/stderr logs, and a structured report. `memory.md` is injected into prompts and updated after agents finish.

For `codex-cli`, AgentDesk starts each subagent with the interactive `codex` command through a pseudo-terminal, not `codex exec`. The initial prompt includes a unique AgentDesk launch token and a report protocol requiring the subagent to write JSON to its assigned `report.json` with `summary`, `tests_run`, `risks`, and `notes`.

AgentDesk discovers the generated Codex rollout under `${CODEX_HOME:-~/.codex}/sessions` by matching that launch token, then records `codexSessionId`, `codexSessionPath`, `codexResumeCommand`, and `codexResumeAllCommand` on the agent. The primary displayed command is `codex resume <codexSessionId>`; AgentDesk also displays `codex resume --all <codexSessionId>` for resuming from another working directory.

Automatic completion is still driven by AgentDesk. The runner streams PTY output to `stdout.log`, records runner errors and timeouts in `stderr.log`, waits for parseable `report.json`, and then asks the interactive Codex session to exit. If Codex exits before a valid report or the report wait times out, the agent is marked failed.

## Codex App Handoff

With `--subagent-launcher codex-app`, AgentDesk prepares session metadata and prompt files but does not start app subagents itself. The MCP result includes `requiresHostLaunch: true` and an `appLaunchPlan`.

Prepared Codex App agents stay in `prepared_for_app`; AgentDesk does not count them as succeeded just because the launch plan was created. The Codex App host owns the actual launch, waiting, and host-side result reporting.
