# AgentDesk Codex Instructions

## Verification Workflow

- When validating UI or runtime behavior served by `npm run dev`, Codex should default to using [@电脑](plugin://computer-use@openai-bundled) to inspect the running app.
- Do not use browser-based validation for `npm run dev` output unless the user explicitly asks for it or Computer Use is unavailable.

## Git Workflow

- After a large code update, Codex should automatically create a git commit once the implementation has been verified.
- "Large code update" includes multi-file feature work, substantial UI redesigns, meaningful refactors, or any change set that would be inconvenient to leave uncommitted.
- Only commit files related to the completed change, and avoid bundling unrelated local edits into the same commit.
- If the user explicitly says not to commit, follow the user's instruction instead.

## Compatibility Direction

- Keep AgentDesk aligned with Codex CLI-style terminal workflows. User-facing docs and flags should describe planner model, reasoning, and fast-mode choices in Codex CLI terms.
- Prefer the local GUI and `ralphctl` terminal commands as the primary interface. Skill-root script discovery exists for legacy Ralph compatibility and should not become the center of new workflows.
- When documenting fast mode, be explicit about whether AgentDesk itself owns the flag or whether the currently installed planner script provides the shortcut.
