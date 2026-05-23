---
name: generate-agentdesk-task
description: "Explicitly specified only: use this skill only when the user writes `$generate-agentdesk-task` or `generate-agentdesk-task` by name. Never infer or proactively trigger it from task content, workflow fit, or task-generation requests alone. When explicitly requested by name, create or prepare an AgentDesk task for a project before subagent execution."
---

# Generate AgentDesk Task

## Explicit Invocation Only

The user must explicitly specify this skill by writing `$generate-agentdesk-task` or `generate-agentdesk-task` by name. Never infer this skill from task content, workflow fit, or task-generation requests alone.

Use this skill to turn a user request into an AgentDesk control-plane task.
By default, generate the task title, brief, checklist, and `task.md` content in Chinese unless the user explicitly asks for another language or the target repository clearly requires another language.
AgentDesk is CLI/MCP-only: use the MCP stdio tools or `verunectl`, and do not introduce GUI, Electron, Web app, or `npm run dev` validation steps unless a future task explicitly adds that supported surface.

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
3. When the task is intended for subagent execution, include enough structure in the generated brief/task notes for the coordinating model to assess task complexity, file ownership, and likely concurrent-edit conflicts before choosing a per-batch subagent count.
4. Prefer MCP:
   - Call `create_agentdesk_task` with `projectRoot`, `title` when known, and a concrete Chinese `brief`.
   - Then call `read_agentdesk_task` until the task reaches `ready` or `failed`.
5. Fallback to CLI when the MCP tool is unavailable:
   - Run `./scripts/verunectl.sh tasks create --project <projectRoot> --title "<title>" --brief "<brief>" --json`, using a Chinese title and brief by default.
   - Use `./scripts/verunectl.sh tasks show <taskId> --project <projectRoot> --json` to inspect the generated task.
6. Verify the generated task has executable checklist subtasks.
7. Report the `taskId`, status, task file path, and any failure message.

## Guardrails

- Keep AgentDesk centered on `task.md`; do not reintroduce PRD JSON, Gemini CLI, or Claude Code compatibility flows.
- Prefer the MCP stdio server and `verunectl` as the supported interfaces.
- Generate user-facing task content in Chinese by default, including titles, briefs, checklist items, task notes, and final summaries.
- Prefer explicit session defaults in user-facing notes: `gpt-5.5`, `xhigh`, service tier `fast`, execution mode `auto`, batches of up to 6, and the repository-designated working branch as the base for new work.
- If the user or repository designates a non-`master` working branch, carry that branch into task notes and do not describe future work as based on or automatically integrated into `master`. In this AgentDesk workspace, use `agentdesk/next` as the working branch and leave any merge to `master` for the user to perform manually.
- Make clear that before subagent execution, the coordinating model should review task complexity and concurrency-conflict risk, decide a recommended per-batch subagent count within the configured cap, notify the user of that recommendation, and respect any later user-selected concurrency.
- If task generation fails, preserve the task directory and summarize `stdout.log` / `stderr.log` rather than deleting artifacts.
