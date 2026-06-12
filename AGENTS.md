# AgentDesk Codex Instructions

## Verification Workflow

- The default AgentDesk workflow is the bundled Codex skills plus MCP/CLI (`task.md`, session history, `verunectl`, and Codex subagent orchestration).
- The local Web UI is an optional beta surface. It is not required for normal AgentDesk usage, task execution, or default validation.
- Only include UI or `npm run dev` validation when a change explicitly touches the beta Web UI, dev server, or Web runtime behavior.
- When validating UI or runtime behavior served by `npm run dev`, Codex should default to using [@电脑](plugin://computer-use@openai-bundled) to inspect the running app.
- Before running `npm run dev`, Codex should check whether the dev server is already running and reuse it when available.
- Only run `npm run dev` when the dev server is not running or cannot be reached.
- Do not use browser-based validation for `npm run dev` output unless the user explicitly asks for it or Computer Use is unavailable.

## Git Workflow

- Use `agentdesk/next` as the default working branch for this repository. Future Codex work in this checkout should be based on `agentdesk/next`, not `master`.
- Before making meaningful changes, Codex should confirm the checkout is on `agentdesk/next` and switch there when needed, unless the user explicitly asks for another branch.
- After a large or important update, Codex should automatically create a git commit on `agentdesk/next` once the implementation has been verified.
- Treat this as the default behavior for meaningful work in this repository. Codex should not wait for a separate "please commit" instruction after substantial implementation is done.
- "Large or important update" includes multi-file feature work, substantial UI redesigns, meaningful refactors, user-facing documentation/configuration changes, MCP or CLI workflow changes, or any change set that would be inconvenient to leave uncommitted or unpushed.
- Before committing, review `git status --short` and stage only files related to the completed change.
- Never bundle unrelated local edits into the same commit, even if they are already present in the worktree.
- Do not merge completed work into `master`, switch the checkout to `master`, or push `master` by default. The user manually reviews and merges `agentdesk/next` into `master`.
- Do not push any branch unless the user explicitly asks for a push.
- If verification was skipped or blocked, Codex should mention that clearly in its final response.
- If the user explicitly says not to commit or not to push, follow the user's instruction instead.

## Skill Sync Workflow

- When a change touches files under `skills/`, Codex should run `./scripts/sync-codex-skills.sh` after verification and before the final response so the repository skill definitions are copied to `${CODEX_HOME:-~/.codex}/skills`.
- If writing to `${CODEX_HOME:-~/.codex}/skills` requires sandbox approval, request approval and run the sync once it is granted.
- If the sync is skipped or blocked, clearly mention that in the final response and leave the repository changes intact.

## Product Direction

- Keep AgentDesk centered on project configuration/selection through CLI/MCP, `task.md` generation, session history, and Codex subagent orchestration.
- Treat the skills-led MCP/CLI flow as the default product path; keep the Web UI clearly labeled as beta and optional.
- Do not reintroduce `prd.json`, Gemini CLI, or the legacy Claude Code compatibility layer. External `claude-code-cli` launcher support is allowed alongside `codex-cli`.
- Session execution defaults should remain explicit in user-facing docs: Codex launchers use `o4-mini` + `low`, Claude launchers use `haiku`, Grok launchers use `composer-2.5-fast`, service tier unset by default, batched launches of 6, and this repository's Codex development baseline of `agentdesk/next`.
- Prefer the MCP stdio server and `verunectl` terminal commands as the primary interface.
