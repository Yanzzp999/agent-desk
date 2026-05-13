import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createContext,
  getRunDetail,
  getTaskLogs,
  getTaskResult,
  listArtifacts,
  listRuns,
  resolveRalphCli,
} from "../src/lib/control-plane.mjs";
import { createControlPlaneServer } from "../src/server/server.mjs";

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

test("resolves Ralph scripts from project-local Gemini and Claude skills roots", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-multi-cli-project-"));
  const geminiPlanCli = path.join(projectRoot, ".gemini", "skills", "ralph", "scripts", "ralph.sh");
  const claudeRunCli = path.join(projectRoot, ".claude", "skills", "ralph-run", "scripts", "ralph-run.sh");

  await fs.mkdir(path.dirname(geminiPlanCli), { recursive: true });
  await fs.mkdir(path.dirname(claudeRunCli), { recursive: true });
  await fs.writeFile(geminiPlanCli, "#!/bin/sh\n", "utf8");
  await fs.writeFile(claudeRunCli, "#!/bin/sh\n", "utf8");

  const context = createContext({ projectRoot });
  assert.equal(context.ralphPlanCli, geminiPlanCli);
  assert.equal(context.ralphRunCli, claudeRunCli);
});

test("falls back to user-level Gemini and Claude skills roots when project-local scripts are missing", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-multi-cli-home-project-"));
  const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-home-"));
  const geminiPlanCli = path.join(homeRoot, ".gemini", "skills", "custom-ralph", "scripts", "ralph.sh");
  const claudeRunCli = path.join(homeRoot, ".claude", "skills", "custom-ralph-run", "scripts", "ralph-run.sh");
  const originalHome = process.env.HOME;

  await fs.mkdir(path.dirname(geminiPlanCli), { recursive: true });
  await fs.mkdir(path.dirname(claudeRunCli), { recursive: true });
  await fs.writeFile(geminiPlanCli, "#!/bin/sh\n", "utf8");
  await fs.writeFile(claudeRunCli, "#!/bin/sh\n", "utf8");

  process.env.HOME = homeRoot;
  try {
    assert.equal(resolveRalphCli("", projectRoot, ["custom-ralph", "scripts", "ralph.sh"]), geminiPlanCli);
    assert.equal(resolveRalphCli("", projectRoot, ["custom-ralph-run", "scripts", "ralph-run.sh"]), claudeRunCli);
  } finally {
    process.env.HOME = originalHome;
  }
});

test("server starts without a project and selects one at runtime", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-select-project-"));
  const stateFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-state-")), "projects.json");
  const runDir = path.join(projectRoot, ".ralph", "runs", "demo-run");
  await fs.mkdir(path.join(runDir, "tasks"), { recursive: true });
  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify({
    runId: "demo-run",
    project: "selectable",
    status: "succeeded",
    taskIds: [],
  }, null, 2)}\n`);

  const server = createControlPlaneServer(null, { stateFile });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const initialHealth = await requestJson(`${baseUrl}/api/health`);
    assert.equal(initialHealth.needsProject, true);

    const runsBeforeProject = await fetch(`${baseUrl}/api/runs`);
    assert.equal(runsBeforeProject.status, 400);

    const selected = await requestJson(`${baseUrl}/api/projects/select`, {
      method: "POST",
      body: { projectRoot },
    });
    assert.equal(selected.current.projectRoot, projectRoot);
    assert.equal(selected.items[0].projectRoot, projectRoot);

    const selectedHealth = await requestJson(`${baseUrl}/api/health`);
    assert.equal(selectedHealth.needsProject, false);
    assert.equal(selectedHealth.projectRoot, projectRoot);

    const runs = await requestJson(`${baseUrl}/api/runs`);
    assert.equal(runs.items.length, 1);
    assert.equal(runs.items[0].runId, "demo-run");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error || response.statusText);
  return payload;
}
