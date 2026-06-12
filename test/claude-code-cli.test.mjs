import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAUDE_CODE_FALLBACK_MODELS,
  buildClaudeCodePrintArgs,
  parseClaudePrintOutput,
  resolveClaudeCodeCliPath,
} from "../src/lib/claude-code-cli.mjs";

test("resolveClaudeCodeCliPath prefers explicit path and env overrides", () => {
  assert.equal(
    resolveClaudeCodeCliPath({ explicitPath: "/tmp/custom-claude" }),
    "/tmp/custom-claude",
  );
  assert.equal(
    resolveClaudeCodeCliPath({ env: { CLAUDE_CODE_CLI: "/tmp/env-claude" } }),
    "/tmp/env-claude",
  );
});

test("buildClaudeCodePrintArgs uses print mode with weakest default model", () => {
  assert.deepEqual(buildClaudeCodePrintArgs({
    cwd: "/tmp/project",
    prompt: "Implement the assigned task.",
  }), [
    "-p",
    "Implement the assigned task.",
    "--model",
    CLAUDE_CODE_FALLBACK_MODELS[0].slug,
    "--dangerously-skip-permissions",
    "--output-format",
    "json",
    "--add-dir",
    "/tmp/project",
  ]);
});

test("parseClaudePrintOutput extracts session resume metadata", () => {
  const stdout = [
    "working...",
    JSON.stringify({
      type: "result",
      session_id: "claude-session-123",
      result: "done",
    }),
  ].join("\n");
  assert.deepEqual(parseClaudePrintOutput(stdout), {
    claudeSessionId: "claude-session-123",
    claudeResumeCommand: "claude --resume claude-session-123",
  });
});