import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  detectGitRoot,
  detectWorkspaceRoot,
  normalizeTaskType,
  validateCodingProjectRoot,
  validateTaskProjectRoot,
} from "../src/lib/task-validation.mjs";

test("normalizes taskType values", () => {
  assert.equal(normalizeTaskType(" CODING "), "coding");
  assert.equal(normalizeTaskType("Research"), "research");
  assert.equal(normalizeTaskType(), "");
});

test("requires absolute projectRoot for coding tasks", async () => {
  await assert.rejects(
    () => validateCodingProjectRoot({ taskType: "coding" }),
    /projectRoot is required when taskType=coding/,
  );
  await assert.rejects(
    () => validateCodingProjectRoot({ taskType: "coding", projectRoot: "relative/project" }),
    /projectRoot must be an absolute path when taskType=coding/,
  );

  const optional = await validateTaskProjectRoot({ taskType: "research" });
  assert.equal(optional.projectRoot, "");
  assert.equal(optional.required, false);
});

test("accepts absolute coding projectRoot without filesystem checks", async () => {
  const projectRoot = path.join(os.tmpdir(), "agent-desk-missing-project-root");
  const result = await validateCodingProjectRoot({ projectRoot });

  assert.equal(result.taskType, "coding");
  assert.equal(result.projectRoot, projectRoot);
  assert.equal(result.required, true);
  assert.equal(result.exists, false);
  assert.equal(result.readable, false);
});

test("checks projectRoot existence and directory shape when requested", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-project-root-"));
  const filePath = path.join(root, "README.md");
  await fs.writeFile(filePath, "# Fixture\n", "utf8");

  const existing = await validateCodingProjectRoot({ projectRoot: root }, {
    checkExists: true,
    checkReadable: true,
  });
  assert.equal(existing.exists, true);
  assert.equal(existing.readable, true);
  assert.equal(existing.realProjectRoot, await fs.realpath(root));

  await assert.rejects(
    () => validateCodingProjectRoot({ projectRoot: path.join(root, "missing") }, { checkExists: true }),
    /projectRoot must exist when taskType=coding/,
  );
  await assert.rejects(
    () => validateCodingProjectRoot({ projectRoot: filePath }, { checkExists: true }),
    /projectRoot must be a directory when taskType=coding/,
  );
});

test("reports unreadable projectRoot when readable check fails", async () => {
  const projectRoot = path.join(os.tmpdir(), "agent-desk-unreadable-project-root");
  await assert.rejects(
    () => validateCodingProjectRoot({ projectRoot }, {
      checkReadable: true,
      stat: async () => ({ isDirectory: () => true }),
      access: async () => {
        const error = new Error("permission denied");
        error.code = "EACCES";
        throw error;
      },
    }),
    /projectRoot must be readable when taskType=coding/,
  );
});

test("detects git roots and workspace roots from nested project paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-root-detect-"));
  const nested = path.join(root, "packages", "app");
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(root, "agentdesk.workspace.json"), "{}\n", "utf8");

  assert.equal(await detectGitRoot(nested), root);
  assert.equal(
    await detectWorkspaceRoot(nested, { workspaceMarkers: ["agentdesk.workspace.json"] }),
    root,
  );

  const result = await validateCodingProjectRoot({ projectRoot: nested }, {
    checkExists: true,
    detectGitRoot: true,
    detectWorkspaceRoot: true,
    workspaceMarkers: ["agentdesk.workspace.json"],
  });
  assert.equal(result.gitRoot, root);
  assert.equal(result.workspaceRoot, root);
});

test("can require git and workspace roots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-root-required-"));
  const projectRoot = path.join(root, "project");
  await fs.mkdir(projectRoot, { recursive: true });

  await assert.rejects(
    () => validateCodingProjectRoot({ projectRoot }, { requireGitRoot: true }),
    /projectRoot must be inside a Git worktree when taskType=coding/,
  );
  await assert.rejects(
    () => validateCodingProjectRoot({ projectRoot }, {
      requireWorkspaceRoot: true,
      workspaceMarkers: ["agentdesk.workspace.json"],
    }),
    /projectRoot must be inside a workspace root containing one of: agentdesk.workspace.json/,
  );
});
