import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");

test("npm package includes bundled Codex skills", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.ok(pkg.files.includes("skills/"));

  for (const skillName of ["generate-agentdesk-task", "run-agentdesk-subagents"]) {
    const skillPath = path.join(REPO_ROOT, "skills", skillName, "SKILL.md");
    const text = await fs.readFile(skillPath, "utf8");
    assert.match(text, new RegExp(`name: ${skillName}`));
    assert.match(text, /Explicit Invocation Only/);
    assert.match(text, /Do not trigger it from task content alone/);
  }
});

test("generate-agentdesk-task skill requires task brief completeness review", async () => {
  const skill = await fs.readFile(
    path.join(REPO_ROOT, "skills", "generate-agentdesk-task", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /Task Brief Completeness Review/);
  assert.match(skill, /complete enough to produce an executable `task\.md`/);
  assert.match(skill, /ask the user a concise follow-up question/);
  assert.match(skill, /before calling `create_agentdesk_task`/);
});

test("run-agentdesk-subagents skill documents bounded concurrency and app handoff", async () => {
  const skill = await fs.readFile(
    path.join(REPO_ROOT, "skills", "run-agentdesk-subagents", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /maximum concurrency limit/);
  assert.match(skill, /Never launch more subagents at once than `parallelism`/);
  assert.match(skill, /only the Codex App host can actually start them/);
});
