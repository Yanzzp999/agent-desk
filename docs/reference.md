# AgentDesk Reference

[中文参考](reference.zh-CN.md)

This page holds reference details that are useful while operating or extending AgentDesk but too verbose for the README front page. Runtime behavior details are in [design.md](design.md).

## Codex Skills

All bundled skills are explicit-invocation only. They are the default AgentDesk product path alongside the MCP stdio server and `verunectl`; the local Web UI is optional beta functionality.

| Skill | Purpose |
| --- | --- |
| `generate-agentdesk-task` | Turn an explicit user request into an AgentDesk control-plane task. It checks whether the brief is complete enough for an executable `task.md` and asks for missing blocking details before creation. |
| `review-agentdesk-task` | Read-only pre-implementation review of an AgentDesk task or `task.md`, focused on ambiguity, missing acceptance criteria, scope mismatch, and future agent misinterpretation risk. |
| `run-agentdesk-subagents` | Run or coordinate an existing task with Codex CLI or Codex App subagents. Configured parallelism is a maximum cap, not a requirement to use every slot. |
| `claim-agentdesk-task` | Atomically claim one open markdown checklist item, implement only that item, and complete it with the same assignee/session identity. |

Before subagent execution, the coordinating model should review task complexity and concurrent-edit conflict risk, choose a recommended per-batch subagent count, and tell the user. The user can still choose a different concurrency value within the configured maximum.

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `create_task` | Create a markdown task file under `<project>/task/`. |
| `list_tasks` | List markdown task files under `<project>/task/`. |
| `read_task` | Read a markdown task file under `<project>/task/`. |
| `claim_task_items` | Write visible AgentDesk claim markers onto selected checklist items. |
| `claim_next_task_item` | Atomically claim the first open, unclaimed checklist item and write the implementing `agent -> sessionId` marker into `task.md`. |
| `complete_task_items` | Atomically check off items claimed by the same assignee and session id. |
| `create_agentdesk_task` | Use Codex CLI to generate `.agent-desk/tasks/<taskId>/task.md`; similar tasks are returned for confirmation before duplicate creation. |
| `list_agentdesk_tasks` | List AgentDesk control-plane tasks from `.agent-desk/tasks`. |
| `read_agentdesk_task` | Read a control-plane task, generated `task.md`, shared `memory.md`, and session summaries. |
| `start_subagent_session` | Start a Codex CLI session or prepare a Codex App launch plan. |
| `list_subagent_sessions` | List AgentDesk sessions from `.agent-desk/sessions`. |
| `read_subagent_session` | Read session status, agent summaries, docs, logs, and Codex App launch-plan details when available. |

## Task Format

Markdown task files use checkbox subtasks:

```md
# Checkout flow

## Goal

Implement the checkout flow end to end.

## Tasks

- [ ] Add payment state model
- [ ] Wire confirmation screen
```

Claiming a task item writes a visible ownership marker under the checkbox:

```md
- [ ] Implement API handler
  - AgentDesk claim: `agent-alpha` at 2026-05-22T10:00:00.000Z; session: `session-abc`; note: implementing
```

Agents should call `claim_next_task_item` before implementation and `complete_task_items` after verification.

## Verification

Useful checks:

```sh
npm test
./scripts/verunectl.sh help
codex --version
```

The local Web UI is beta and optional, so do not include UI validation for ordinary skills, MCP, CLI, task, or session changes. For changes that touch the beta UI or Web runtime, follow the repository rules: check whether a dev server is already running, start one only when needed, and prefer Computer Use for local UI validation.
