---
name: generate-agentdesk-task
description: "Explicit-use only: use this skill only when the user explicitly names `$generate-agentdesk-task` or `generate-agentdesk-task`, or otherwise unambiguously asks to use this specific skill. Do not proactively trigger it from task content alone. When explicitly requested, create or prepare an AgentDesk task for a project before subagent execution."
---

# Generate AgentDesk Task

## Explicit Invocation Only

Do not use this skill unless the user explicitly names `$generate-agentdesk-task` or `generate-agentdesk-task`, or otherwise unambiguously asks to use this specific skill. Do not trigger it from task content alone.

Use this skill to turn a user request into an AgentDesk control-plane task.
By default, generate the task title, brief, checklist, and `task.md` content in Chinese unless the user explicitly asks for another language or the target repository clearly requires another language.

## Task Brief Completeness Review

Before creating an AgentDesk task, review whether the user's request is complete enough to produce an executable `task.md`.

Treat the request as complete when it provides, or the current workspace lets you safely infer, these essentials:

- Target project root or repository.
- Concrete goal or outcome.
- Scope boundaries, including what should not be changed when relevant.
- Acceptance criteria or verification expectations.
- Important constraints such as branch, launcher, concurrency, files, services, or deadlines.

If any essential detail is missing and cannot be safely inferred from local context, ask the user a concise follow-up question and wait for the answer before calling `create_agentdesk_task` or the CLI fallback.
Do not ask for extra detail when the missing information is non-blocking or the repository context provides a reasonable default.

## Workflow

1. Confirm the project root from the current workspace unless the user provides one.
2. Review task brief completeness using the checklist above; ask the user for missing blocking details before generating the task.
3. Prefer MCP:
   - Call `create_agentdesk_task` with `projectRoot`, `title` when known, and a concrete Chinese `brief`.
   - Then call `read_agentdesk_task` until the task reaches `ready` or `failed`.
4. Fallback to CLI when the MCP tool is unavailable:
   - Run `./scripts/verunectl.sh tasks create --project <projectRoot> --title "<title>" --brief "<brief>" --json`, using a Chinese title and brief by default.
   - Use `./scripts/verunectl.sh tasks show <taskId> --project <projectRoot> --json` to inspect the generated task.
5. Verify the generated task has executable checklist subtasks.
6. Report the `taskId`, status, task file path, and any failure message.

## Guardrails

- Keep AgentDesk centered on `task.md`; do not reintroduce PRD JSON, Gemini CLI, or Claude Code compatibility flows.
- Generate user-facing task content in Chinese by default, including titles, briefs, checklist items, task notes, and final summaries.
- Prefer explicit session defaults in user-facing notes: `gpt-5.5`, `xhigh`, `fast`, batches of 6, integration into `master`.
- If task generation fails, preserve the task directory and summarize `stdout.log` / `stderr.log` rather than deleting artifacts.
