# AgentDesk Codex Instructions

## Verification Workflow

- This repository is currently CLI/MCP-only and does not provide a local GUI, Electron shell, Web app, or `npm run dev` workflow.
- Only include UI or `npm run dev` validation when a future change explicitly adds a supported dev script and UI/Web source.
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

## Product Direction

- Keep AgentDesk centered on project configuration/selection through CLI/MCP, `task.md` generation, session history, and Codex subagent orchestration.
- Do not reintroduce `prd.json`, Gemini CLI, or Claude Code compatibility features.
- Session execution defaults should remain explicit in user-facing docs: `gpt-5.5`, `xhigh`, `fast`, batched launches of 6, and this repository's Codex development baseline of `agentdesk/next`.
- Prefer the MCP stdio server and `verunectl` terminal commands as the primary interface.
