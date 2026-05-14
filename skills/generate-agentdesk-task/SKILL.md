---
name: generate-agentdesk-task
description: Use when the user asks to create, generate, or prepare an AgentDesk task for a project, especially before running subagents. Prefer the AgentDesk MCP task-generation tool when available; otherwise use verunectl task generation. Do not use for generic Markdown notes unrelated to AgentDesk execution.
---

# Generate AgentDesk Task

Use this skill to turn a user request into an AgentDesk control-plane task.

## Workflow

1. Confirm the project root from the current workspace unless the user provides one.
2. Prefer MCP:
   - Call `create_agentdesk_task` with `projectRoot`, `title` when known, and a concrete `brief`.
   - Then call `read_agentdesk_task` until the task reaches `ready` or `failed`.
3. Fallback to CLI when the MCP tool is unavailable:
   - Run `./scripts/verunectl.sh tasks create --project <projectRoot> --title "<title>" --brief "<brief>" --json`.
   - Use `./scripts/verunectl.sh tasks show <taskId> --project <projectRoot> --json` to inspect the generated task.
4. Verify the generated task has executable checklist subtasks.
5. Report the `taskId`, status, task file path, and any failure message.

## Guardrails

- Keep AgentDesk centered on `task.md`; do not reintroduce PRD JSON, Gemini CLI, or Claude Code compatibility flows.
- Prefer explicit session defaults in user-facing notes: `gpt-5.5`, `xhigh`, `fast`, batches of 6, integration into `master`.
- If task generation fails, preserve the task directory and summarize `stdout.log` / `stderr.log` rather than deleting artifacts.
