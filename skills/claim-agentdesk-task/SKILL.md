---
name: claim-agentdesk-task
description: "Explicit-use only: use this skill only when the user explicitly names `$claim-agentdesk-task` or `claim-agentdesk-task`, or otherwise unambiguously asks an agent to claim one item from an AgentDesk markdown task and implement it. Do not proactively trigger it from task content alone. When invoked, atomically claim one checklist item, implement only that item, and complete it through AgentDesk."
---

# Claim AgentDesk Task

## Explicit Invocation Only

Do not use this skill unless the user explicitly names `$claim-agentdesk-task` or `claim-agentdesk-task`, or otherwise unambiguously asks you to claim one AgentDesk task item and implement it. Do not trigger it from task content alone.

Use this skill when multiple agents may independently pull work from the same markdown task file.

## Required Identity

Before claiming work, determine:

- `taskName`: the task filename, title, or title slug under `task/`.
- `assignee`: a stable agent name for this run.
- `sessionId`: the current Codex/session id.

If `sessionId` is not available from the user, environment, or current session context, stop before implementing. The visible claim marker must include both assignee and session id.

## MCP Workflow

1. Call `claim_next_task_item` with `taskName`, `assignee`, and `sessionId`.
2. If it returns `hasWork: false`, report that no unclaimed checklist item remains and do not edit project files.
3. If it returns a claimed item, read the returned item title/details and implement only that item.
4. Do not modify other checklist items or AgentDesk claim markers by hand.
5. Run focused verification for the claimed item.
6. Call `complete_task_items` with the claimed item index/title, the same `assignee`, and the same `sessionId`.
7. Summarize the claimed item, verification, and any residual risk.

## Guardrails

- Never start implementation before `claim_next_task_item` succeeds.
- Never claim more than one item in this workflow unless the user explicitly asks for another claim after completion.
- Never complete an item claimed by a different assignee or session id.
- MCP is the required coordination path. If MCP is unavailable, do not manually edit the task file to simulate a claim.
