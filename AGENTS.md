# AgentDesk Codex Instructions

## Verification Workflow

- When validating UI or runtime behavior served by `npm run dev`, Codex should default to using [@电脑](plugin://computer-use@openai-bundled) to inspect the running app.
- Before running `npm run dev`, Codex should check whether the dev server is already running and reuse it when available.
- Only run `npm run dev` when the dev server is not running or cannot be reached.
- Do not use browser-based validation for `npm run dev` output unless the user explicitly asks for it or Computer Use is unavailable.

## Git Workflow

- After a large or important update, Codex should automatically create a git commit once the implementation has been verified, then push the committed branch to its configured remote.
- Treat this as the default behavior for meaningful work in this repository. Codex should not wait for a separate "please commit" or "please push" instruction after substantial implementation is done.
- "Large or important update" includes multi-file feature work, substantial UI redesigns, meaningful refactors, user-facing documentation/configuration changes, MCP or CLI workflow changes, or any change set that would be inconvenient to leave uncommitted or unpushed.
- Before committing, review `git status --short` and stage only files related to the completed change.
- Never bundle unrelated local edits into the same commit, even if they are already present in the worktree.
- Before pushing, verify the current branch has an upstream. Set the upstream when appropriate, but do not force-push unless the user explicitly asks for it.
- If verification was skipped or blocked, Codex should mention that clearly in its final response.
- If the user explicitly says not to commit or not to push, follow the user's instruction instead.

## Product Direction

- Keep AgentDesk centered on project selection, `task.md` generation, session history, and Codex subagent orchestration.
- Do not reintroduce `prd.json`, Gemini CLI, or Claude Code compatibility features.
- Session execution defaults should remain explicit in user-facing docs: `gpt-5.5`, `xhigh`, `fast`, batched launches of 6, and integration into `master`.
- Prefer the local GUI and `verunectl` terminal commands as the primary interface.
