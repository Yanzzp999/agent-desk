import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createContext,
  getRunDetail,
  getTaskLogs,
  getTaskResult,
  listArtifacts,
  listRuns,
} from "../src/lib/control-plane.mjs";

test("reads Ralph run state, logs, results, and artifacts", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-cp-"));
  const runDir = path.join(projectRoot, ".ralph", "runs", "demo-run");
  await fs.mkdir(path.join(runDir, "tasks"), { recursive: true });
  await fs.mkdir(path.join(runDir, "logs"), { recursive: true });
  await fs.mkdir(path.join(runDir, "results"), { recursive: true });

  const run = {
    runId: "demo-run",
    project: "demo",
    status: "running",
    maxParallel: 2,
    taskIds: ["US-001", "US-002"],
    updatedAt: "2026-05-13T08:00:00.000Z",
  };
  const firstTask = {
    id: "US-001",
    title: "Build API",
    status: "succeeded",
    priority: 1,
    dependencies: [],
    logPath: path.join(runDir, "logs", "US-001.log"),
    resultPath: path.join(runDir, "results", "US-001.md"),
  };
  const secondTask = {
    id: "US-002",
    title: "Build UI",
    status: "queued",
    priority: 2,
    dependencies: ["US-001"],
    logPath: path.join(runDir, "logs", "US-002.log"),
    resultPath: path.join(runDir, "results", "US-002.md"),
  };

  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  await fs.writeFile(path.join(runDir, "tasks", "US-001.json"), `${JSON.stringify(firstTask, null, 2)}\n`);
  await fs.writeFile(path.join(runDir, "tasks", "US-002.json"), `${JSON.stringify(secondTask, null, 2)}\n`);
  await fs.writeFile(firstTask.logPath, "line 1\nline 2\nline 3\n");
  await fs.writeFile(firstTask.resultPath, "# Result\n\nStatus: succeeded\n");
  await fs.writeFile(path.join(runDir, "report.md"), "# Report\n");

  const context = createContext({ projectRoot });
  const runs = await listRuns(context);
  assert.equal(runs.items.length, 1);
  assert.equal(runs.items[0].runId, "demo-run");
  assert.equal(runs.items[0].counts.succeeded, 1);
  assert.equal(runs.items[0].counts.queued, 1);

  const detail = await getRunDetail(context, "demo-run");
  assert.equal(detail.tasks.length, 2);
  assert.equal(detail.summary.blockedTasks.length, 0);

  const logs = await getTaskLogs(context, "demo-run", "US-001", { lines: 2 });
  assert.match(logs.content, /line 2/);
  assert.match(logs.content, /line 3/);

  const result = await getTaskResult(context, "demo-run", "US-001");
  assert.match(result.content, /Status: succeeded/);

  const artifacts = await listArtifacts(context);
  assert.equal(artifacts.items.some((item) => item.kind === "run-report"), true);
  assert.equal(artifacts.items.some((item) => item.kind === "task-result"), true);
});
