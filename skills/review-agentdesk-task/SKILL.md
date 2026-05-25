---
name: review-agentdesk-task
description: "Explicitly specified only: use this skill only when the user writes `$review-agentdesk-task` or `review-agentdesk-task` by name. Never infer this skill from task content, generic review, planning, task-generation, or implementation requests alone. When explicitly requested by name, perform a read-only pre-implementation review of an AgentDesk task or task.md to find ambiguity, missing acceptance details, scope mismatches, and likely ways future agents could implement something different from the user's intent."
---

# Review AgentDesk Task

## Explicit Invocation Only

The user must explicitly specify this skill by writing `$review-agentdesk-task` or `review-agentdesk-task` by name. Never infer this skill from task content, generic review, planning, task-generation, or implementation requests alone.

Use this skill before implementation or subagent fanout to verify that an AgentDesk task is clear, aligned with the user's intent, and safe for future agents to execute without guessing.

This is a read-only review workflow. Do not claim checklist items, start subagents, complete task items, edit project files, or write task clarifications unless the user explicitly asks for edits after the review.

## Scope

Review one target task at a time. The target can be:

- An AgentDesk control-plane task id under `.agent-desk/tasks/<taskId>`.
- A generated `.agent-desk/tasks/<taskId>/task.md` path.
- A markdown task under `<project>/task/*.task.md`.
- A task title or filename when the MCP tools can resolve it unambiguously.

If the target task is missing or ambiguous, ask one concise follow-up question before reviewing.

## Read-Only Workflow

1. Confirm the project root from the current workspace unless the user provides one.
2. Read the task through MCP when available:
   - Use `read_agentdesk_task` for `.agent-desk/tasks/<taskId>` tasks.
   - Use `read_task` for `<project>/task/*.task.md` tasks.
3. If MCP is unavailable, read the relevant local markdown files directly without modifying them.
4. Compare the task against available intent evidence:
   - The user's latest request or supplied brief.
   - The task `brief.md`, `task.md`, `meta.json`, and `memory.md` when present.
   - Repository rules such as `AGENTS.md`, README docs, and obvious local architecture when the task depends on them.
5. Identify gaps that could cause future agents to implement the wrong thing.
6. Run only lightweight, read-only checks needed to support the review, such as listing files or searching code. Do not run implementation, build, UI, or subagent workflows just to review clarity.
7. Report findings and recommended clarifications. Do not mutate task files unless the user explicitly asks for an update.

## Review Checklist

Prioritize issues that would change what gets built:

- User intent mismatch: the task says something materially different from the original request or project direction.
- Entity granularity mismatch: the task confuses overall tasks, checklist items, sessions, claims, agents, or subagents.
- Missing acceptance criteria: future agents cannot know when the work is done.
- Missing data model decisions: required fields, persistence location, migration, fallback, or compatibility are unclear.
- Missing execution constraints: project root, branch, launcher, concurrency, UI/runtime expectations, or forbidden compatibility paths are absent or contradictory.
- Scope creep: the task invites unrelated refactors, UI work, protocol changes, or product surfaces beyond the user's request.
- Verification gaps: tests, smoke checks, UI validation, or MCP/CLI checks are too vague for repeatable validation.
- Concurrency and ownership risks: subtasks could edit the same files or overlap without guidance.
- Human readability gaps: required status, claim, dispatch, or audit information is not visible where humans are expected to inspect it.

## Output Format

Lead with the review verdict:

- `Ready`: no blocking ambiguity; implementation can proceed.
- `Needs clarification`: implementation is possible but likely to diverge without specific answers.
- `Blocked`: implementation should not start until the task is corrected or the user answers blocking questions.

Then list findings first, ordered by severity:

- `P0`: would almost certainly lead to the wrong implementation or unsafe execution.
- `P1`: likely ambiguity or mismatch that should be clarified before subagents run.
- `P2`: useful clarification or wording improvement, but not blocking.

For each finding, include:

- The affected task section or line when available.
- The risk in plain language.
- The recommended clarification or decision.

End with:

- `Open questions`: the minimum questions the user should answer, if any.
- `Suggested task edits`: concise wording changes only when helpful. Present them as suggestions, not as applied edits.

## Guardrails

- Never call `claim_next_task_item`, `claim_task_items`, `complete_task_items`, or `start_subagent_session` during this review.
- Never edit task files, README files, source files, or claim markers unless the user explicitly asks you to apply the suggested clarifications.
- Do not treat the existence of checklist items as proof that the task is clear; review the goal, context, acceptance criteria, and execution constraints together.
- If the user asks for both review and implementation, finish the review first and call out any blockers before starting implementation.
- In this AgentDesk workspace, flag any task that defaults future work to `master`; future implementation should be based on `agentdesk/next` unless the user explicitly asks otherwise.
