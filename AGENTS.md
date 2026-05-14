# AgentDesk Codex Instructions

## Verification Workflow

- When validating UI or runtime behavior served by `npm run dev`, Codex should default to using [@电脑](plugin://computer-use@openai-bundled) to inspect the running app.
- Before running `npm run dev`, Codex should check whether the dev server is already running and reuse it when available.
- Only run `npm run dev` when the dev server is not running or cannot be reached.
- Do not use browser-based validation for `npm run dev` output unless the user explicitly asks for it or Computer Use is unavailable.

## Git Workflow

- After a large or important update, Codex should automatically create a git commit once the implementation has been verified, then push the committed branch to its configured remote.
- "Large or important update" includes multi-file feature work, substantial UI redesigns, meaningful refactors, user-facing documentation/configuration changes, or any change set that would be inconvenient to leave uncommitted or unpushed.
- Only commit files related to the completed change, and avoid bundling unrelated local edits into the same commit.
- If the user explicitly says not to commit or not to push, follow the user's instruction instead.

## Product Direction

- Keep AgentDesk centered on project selection, `task.md` generation, session history, and Codex subagent orchestration.
- Do not reintroduce `prd.json`, Gemini CLI, or Claude Code compatibility features.
- Session execution defaults should remain explicit in user-facing docs: `gpt-5.5`, `xhigh`, `fast`, batched launches of 6, and integration into `master`.
- Prefer the local GUI and `ralphctl` terminal commands as the primary interface.
