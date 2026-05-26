import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { createContext } from "../src/lib/control-plane.mjs";
import {
  claimOverallTask,
  createOverallTask,
  dispatchOverallTask,
  getOverallTask,
  listOverallTasks,
} from "../src/lib/overall-tasks.mjs";

const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const VERUNECTL = path.join(REPO_ROOT, "bin", "verunectl.mjs");

test("overall task store supports period list, claim, dispatch, and audit state", async () => {
  const projectRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-overall-")));
  await fs.mkdir(path.join(projectRoot, ".agent-desk"), { recursive: true });
  const userDeskRoot = path.join(projectRoot, "home", ".agent-desk");
  const context = createContext({ projectRoot, userDeskRoot });

  const created = await createOverallTask(context, {
    title: "Overall SQLite task",
    description: "Implement the management task flow.",
    taskType: "coding",
    periodType: "week",
    periodKey: "2026-W22",
    status: "ready",
    priority: "high",
    assignee: "worker",
    projectRoot,
  });

  assert.equal(created.ok, true);
  assert.equal(created.task.periodType, "week");
  assert.equal(created.task.periodKey, "2026-W22");
  assert.equal(created.task.priorityLabel, "high");
  assert.equal(created.task.scope, "project");
  assert.ok(await exists(path.join(userDeskRoot, "tasks.sqlite")));

  const userTask = await createOverallTask(context, {
    title: "User-level planning",
    description: "Coordinate tasks before choosing a project.",
    taskType: "general",
    periodType: "week",
    periodKey: "2026-W22",
    status: "ready",
  });
  assert.equal(userTask.task.projectRoot, "");
  assert.equal(userTask.task.scope, "user");

  await assert.rejects(
    () => createOverallTask(context, {
      title: "Coding task without project",
      taskType: "coding",
      projectRoot: "",
      periodType: "week",
      periodKey: "2026-W22",
    }),
    /projectRoot is required/,
  );

  const listed = await listOverallTasks(context, { periodType: "week", periodKey: "2026-W22" });
  assert.deepEqual(
    listed.items.map((task) => task.overallTaskId).sort(),
    [created.task.overallTaskId, userTask.task.overallTaskId].sort(),
  );

  const projectListed = await listOverallTasks(context, {
    projectRoot,
    periodType: "week",
    periodKey: "2026-W22",
  });
  assert.deepEqual(
    projectListed.items.map((task) => task.overallTaskId).sort(),
    [created.task.overallTaskId, userTask.task.overallTaskId].sort(),
  );

  const claimed = await claimOverallTask(context, created.task.overallTaskId, {
    assignee: "worker",
    sessionId: "session-claim",
    note: "claiming coding task",
  });
  assert.equal(claimed.task.status, "claimed");
  assert.equal(claimed.task.claim.claimedBy, "worker");
  assert.equal(claimed.task.claim.note, "claiming coding task");

  await assert.rejects(
    () => claimOverallTask(context, created.task.overallTaskId, {
      assignee: "other",
      sessionId: "session-other",
    }),
    /already claimed/,
  );

  const dispatched = await dispatchOverallTask(context, created.task.overallTaskId, {
    assignee: "worker",
    sessionId: "session-claim",
    branch: "agentdesk/next",
    dispatchTarget: "codex-cli",
    agentdeskTaskId: "task-control-plane",
    note: "dispatching to AgentDesk",
  });
  assert.equal(dispatched.task.status, "dispatched");
  assert.equal(dispatched.task.dispatch.sessionId, "session-claim");
  assert.equal(dispatched.task.dispatch.target, "codex-cli");
  assert.equal(dispatched.task.dispatch.agentdeskTaskId, "task-control-plane");
  assert.equal(dispatched.task.dispatch.note, "dispatching to AgentDesk");

  const read = await getOverallTask(context, created.task.overallTaskId);
  assert.deepEqual(
    read.task.audit.map((event) => event.action),
    ["create", "claim", "status_change", "dispatch", "status_change"],
  );
});

test("verunectl overall-tasks exposes JSON state", async () => {
  const projectRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-overall-cli-")));
  await fs.mkdir(path.join(projectRoot, ".agent-desk"), { recursive: true });
  const sqlitePath = path.join(projectRoot, "home", ".agent-desk", "tasks.sqlite");

  const created = await runJson([
    "overall-tasks",
    "create",
    "--project",
    projectRoot,
    "--sqlite-path",
    sqlitePath,
    "--title",
    "CLI overall task",
    "--description",
    "Created through verunectl.",
    "--period",
    "month",
    "--period-key",
    "2026-05",
    "--assignee",
    "cli-worker",
    "--json",
  ]);

  assert.equal(created.task.periodType, "month");
  assert.equal(created.task.periodKey, "2026-05");

  const listed = await runJson([
    "overall-tasks",
    "list",
    "--project",
    projectRoot,
    "--sqlite-path",
    sqlitePath,
    "--period",
    "month",
    "--period-key",
    "2026-05",
    "--json",
  ]);
  assert.deepEqual(listed.items.map((task) => task.overallTaskId), [created.task.overallTaskId]);
});

async function runJson(args) {
  const result = await run(process.execPath, [VERUNECTL, ...args], { cwd: REPO_ROOT });
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function exists(filePath) {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}
