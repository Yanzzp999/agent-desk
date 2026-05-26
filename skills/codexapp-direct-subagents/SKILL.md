---
name: codexapp-direct-subagents
description: "Use when the user explicitly writes `$codexapp-direct-subagents` or `codexapp-direct-subagents`, or explicitly asks to dispatch Codex App subagents directly without creating or writing an AgentDesk task. This skill bypasses AgentDesk task/session generation and uses Codex App subagents directly, defaulting to model `gpt-5.5` and reasoning `xhigh`."
---

# Codex App Direct Subagents

## Explicit Invocation Only

The user must explicitly specify this skill by writing `$codexapp-direct-subagents` or `codexapp-direct-subagents` by name, or explicitly ask to use Codex App to directly dispatch subagents without creating a task. Never infer this skill from task content, workflow fit, or generic subagent-related requests alone.

This is a lightweight Codex App fanout path. Do not create `task.md`, call `create_agentdesk_task`, call `start_subagent_session`, or run `verunectl sessions start` for this workflow.

## Defaults

- Model: `gpt-5.5`
- Reasoning effort: `xhigh`
- Default maximum batch size: `6`
- Launcher: Codex App host `spawn_agent`

When calling `spawn_agent`, set `model: "gpt-5.5"` and `reasoning_effort: "xhigh"` unless the user explicitly asks for different values. Leave service tier unset unless the user explicitly requests one and the host tool supports it.

## Workflow

1. Confirm the target repository or project root from the current workspace unless the user provides one.
2. Break the request into concrete, bounded subagent prompts only when parallel delegation is actually useful.
3. Keep the main agent on the immediate critical path. Delegate independent sidecar work or disjoint implementation slices.
4. For implementation work, use `agent_type: "worker"`. For read-only codebase questions, use `agent_type: "explorer"`.
5. Give every subagent a self-contained prompt with:
   - The concrete objective.
   - Its owned files, modules, or responsibility area.
   - The rule that other agents may also be editing the codebase, so it must not revert unrelated changes.
   - Expected verification and final reporting, including changed file paths for code edits.
6. Launch at most `6` subagents in a batch unless the user gives a different cap.
7. Do useful non-overlapping local work while subagents run.
8. Wait for subagents only when their results are needed for the next critical-path step.
9. Review returned changes or findings before integrating them into the final answer.
10. Summarize launched count, model/reasoning, subagent responsibilities, changed files, verification, and any unresolved risk.

## Guardrails

- Never use this skill for vague requests for "deep analysis" or "be thorough" unless the user also explicitly asks for subagents or direct Codex App fanout.
- Do not create or mutate AgentDesk task/session state in this workflow.
- Do not dispatch multiple agents into the same write scope unless the user explicitly accepts the conflict risk.
- If a request is not divisible or has unsafe overlapping write ownership, use fewer subagents and explain why.
- In this AgentDesk workspace, keep local repository work based on `agentdesk/next` unless the user explicitly asks for another branch.
