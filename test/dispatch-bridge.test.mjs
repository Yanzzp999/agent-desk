import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createContext, materializeControlPlaneTask, parseTaskMarkdownItems } from "../src/lib/control-plane.mjs";
import { createOverallTaskApiStore } from "../src/lib/overall-tasks.mjs";

async function tmpDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("materializeControlPlaneTask writes a runnable task dir with the subtask checklist", async () => {
  const projectRoot = await tmpDir("ad-mat-");
  const context = createContext({ projectRoot });
  const markdown = [
    "# Demo",
    "## Subtasks",
    "- [ ] First subtask",
    "- [ ] Exclusive one <!-- ad:parallel=1 -->",
  ].join("\n");

  const meta = await materializeControlPlaneTask(context, {
    taskId: "task-demo-1",
    title: "Demo",
    brief: "brief text",
    markdown,
  });

  assert.equal(meta.taskId, "task-demo-1");
  assert.equal(meta.status, "ready");
  assert.equal(meta.subtaskCount, 2);

  // task.md exists and parses to two items, the second carrying the parallel hint.
  const onDisk = await fsp.readFile(meta.paths.taskMd, "utf8");
  const items = parseTaskMarkdownItems(onDisk);
  assert.equal(items.length, 2);
  assert.equal(items[1].parallel, 1);

  // Supporting files exist so the session runner can read them.
  for (const p of [meta.paths.metaJson, meta.paths.briefMd, meta.paths.memoryMd]) {
    assert.ok(fs.existsSync(p), `${p} should exist`);
  }

  await fsp.rm(projectRoot, { recursive: true, force: true });
});

test("dispatch on a non-git project records dispatch state only (no execution)", async () => {
  const projectRoot = await tmpDir("ad-nogit-");
  const sqlitePath = path.join(projectRoot, "tasks.sqlite");
  const store = await createOverallTaskApiStore({ projectRoot, sqlitePath });

  const created = await store.createTask({
    title: "Non-git coding task",
    brief: "should not launch codex",
    scope: "project",
    taskType: "coding",
    projectRoot,
    status: "ready",
  });

  // Send execution params; because projectRoot is not a git repo, the bridge must fall back.
  const dispatched = await store.dispatchTask(created.taskId, {
    projectRoot,
    parallel: 4,
    model: "gpt-5.5",
    reasoning: "xhigh",
    serviceTier: "fast",
    launchBatchSize: 6,
  });

  // The task is recorded as dispatched, but no real session dir was created under .agent-desk/sessions.
  assert.equal(dispatched.status, "running");
  const sessionsDir = path.join(projectRoot, ".agent-desk", "sessions");
  assert.equal(fs.existsSync(sessionsDir), false, "no codex session should be created for a non-git project");

  await store.close();
  await fsp.rm(projectRoot, { recursive: true, force: true });
});
