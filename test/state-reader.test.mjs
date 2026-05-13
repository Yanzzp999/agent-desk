import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_DESK_STATE_DIRNAME,
  createContext,
  getAgentLogs,
  getSession,
  getTask,
  listSessions,
  listTasks,
  parseTaskMarkdownItems,
  renderSessionDocument,
} from "../src/lib/control-plane.mjs";
import { createControlPlaneServer } from "../src/server/server.mjs";

test("createContext uses project-scoped .agent-desk roots", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-context-"));
  const context = createContext({ projectRoot });

  assert.equal(context.projectRoot, projectRoot);
  assert.equal(context.deskRoot, path.join(projectRoot, AGENT_DESK_STATE_DIRNAME));
  assert.equal(context.tasksRoot, path.join(projectRoot, AGENT_DESK_STATE_DIRNAME, "tasks"));
  assert.equal(context.sessionsRoot, path.join(projectRoot, AGENT_DESK_STATE_DIRNAME, "sessions"));
  assert.match(context.worktreesRoot, /agent-desk\/worktrees/);
});

test("parses markdown checklist subtasks for subagent fanout", () => {
  const markdown = `
# Ship session orchestrator

## Goal
Make AgentDesk launch persistent worktree-based subagents.

## Subtasks
- [ ] Replace PRD JSON generation with task markdown generation
- [ ] Add session scheduler with configurable parallelism
1. [ ] Persist session docs after each subagent
`;

  const items = parseTaskMarkdownItems(markdown);
  assert.deepEqual(items.map((item) => item.title), [
    "Replace PRD JSON generation with task markdown generation",
    "Add session scheduler with configurable parallelism",
    "Persist session docs after each subagent",
  ]);
});

test("reads task, session, and agent log state from .agent-desk", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-state-"));
  const deskRoot = path.join(projectRoot, ".agent-desk");
  const taskDir = path.join(deskRoot, "tasks", "task-demo");
  const sessionDir = path.join(deskRoot, "sessions", "session-demo");
  const agentDir = path.join(sessionDir, "agents", "agent-01");

  await fs.mkdir(taskDir, { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });

  const taskMeta = {
    schemaVersion: 2,
    taskId: "task-demo",
    title: "Ship AgentDesk orchestration",
    brief: "Replace the old Ralph workflow with task/session orchestration.",
    status: "ready",
    createdAt: "2026-05-13T10:00:00.000Z",
    updatedAt: "2026-05-13T10:05:00.000Z",
    completedAt: "2026-05-13T10:05:00.000Z",
    lastError: "",
    subtaskCount: 3,
    paths: {
      taskDir,
      briefMd: path.join(taskDir, "brief.md"),
      promptMd: path.join(taskDir, "prompt.md"),
      taskMd: path.join(taskDir, "task.md"),
      metaJson: path.join(taskDir, "meta.json"),
      stdoutLog: path.join(taskDir, "stdout.log"),
      stderrLog: path.join(taskDir, "stderr.log"),
    },
  };
  const sessionMeta = {
    schemaVersion: 2,
    sessionId: "session-demo",
    taskId: "task-demo",
    title: "Ship AgentDesk orchestration",
    status: "succeeded",
    parallelism: 4,
    batchSize: 6,
    createdAt: "2026-05-13T11:00:00.000Z",
    updatedAt: "2026-05-13T11:05:00.000Z",
    startedAt: "2026-05-13T11:00:00.000Z",
    completedAt: "2026-05-13T11:05:00.000Z",
    lastError: "",
    totalAgents: 1,
    succeededAgents: 1,
    failedAgents: 0,
    runningAgents: 0,
    agents: [
      {
        id: "agent-01",
        order: 1,
        title: "Replace PRD JSON generation",
        status: "succeeded",
        branchName: "agentdesk/task-demo/session-demo/agent-01",
        worktreePath: "/tmp/worktrees/agent-01",
        baseCommit: "abc123",
        headCommit: "def456",
        mergedCommit: "def456",
        changedFiles: ["src/lib/control-plane.mjs"],
        testsRun: ["npm test"],
        risks: [],
        notes: ["Scoped to backend state changes"],
        summary: "Replaced PRD JSON task generation with markdown generation.",
        startedAt: "2026-05-13T11:00:00.000Z",
        updatedAt: "2026-05-13T11:04:00.000Z",
        completedAt: "2026-05-13T11:04:00.000Z",
        exitCode: 0,
        lastError: "",
        paths: {
          agentDir,
          promptMd: path.join(agentDir, "prompt.md"),
          reportJson: path.join(agentDir, "report.json"),
          stdoutLog: path.join(agentDir, "stdout.log"),
          stderrLog: path.join(agentDir, "stderr.log"),
        },
      },
    ],
    paths: {
      sessionDir,
      metaJson: path.join(sessionDir, "meta.json"),
      docMd: path.join(sessionDir, "session.md"),
      stdoutLog: path.join(sessionDir, "stdout.log"),
      stderrLog: path.join(sessionDir, "stderr.log"),
    },
  };

  await fs.writeFile(taskMeta.paths.metaJson, `${JSON.stringify(taskMeta, null, 2)}\n`);
  await fs.writeFile(taskMeta.paths.taskMd, "# Ship AgentDesk orchestration\n\n- [ ] Replace PRD JSON generation\n");
  await fs.writeFile(sessionMeta.paths.metaJson, `${JSON.stringify(sessionMeta, null, 2)}\n`);
  await fs.writeFile(sessionMeta.paths.docMd, renderSessionDocument(sessionMeta, taskMeta));
  await fs.writeFile(sessionMeta.agents[0].paths.stdoutLog, "stdout line\n");
  await fs.writeFile(sessionMeta.agents[0].paths.stderrLog, "stderr line\n");

  const context = createContext({ projectRoot });
  const tasks = await listTasks(context);
  assert.equal(tasks.items.length, 1);
  assert.equal(tasks.items[0].taskId, "task-demo");
  assert.equal(tasks.items[0].sessionCount, 1);

  const taskDetail = await getTask(context, "task-demo");
  assert.match(taskDetail.markdown, /Replace PRD JSON generation/);
  assert.equal(taskDetail.sessions.length, 1);

  const sessions = await listSessions(context);
  assert.equal(sessions.items.length, 1);
  assert.equal(sessions.items[0].taskTitle, "Ship AgentDesk orchestration");

  const sessionDetail = await getSession(context, "session-demo");
  assert.match(sessionDetail.docContent, /Session session-demo/);

  const logs = await getAgentLogs(context, "session-demo", "agent-01");
  assert.match(logs.stdout, /stdout line/);
  assert.match(logs.stderr, /stderr line/);
});

test("server starts without a project and selects one at runtime", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-select-project-"));
  const stateFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-state-file-")), "projects.json");
  const taskDir = path.join(projectRoot, ".agent-desk", "tasks", "task-demo");

  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, "meta.json"), `${JSON.stringify({
    schemaVersion: 2,
    taskId: "task-demo",
    title: "Selectable task",
    brief: "Generated task markdown",
    status: "ready",
    createdAt: "2026-05-13T12:00:00.000Z",
    updatedAt: "2026-05-13T12:00:00.000Z",
    completedAt: "2026-05-13T12:00:00.000Z",
    lastError: "",
    subtaskCount: 1,
    paths: {
      taskDir,
      briefMd: path.join(taskDir, "brief.md"),
      promptMd: path.join(taskDir, "prompt.md"),
      taskMd: path.join(taskDir, "task.md"),
      metaJson: path.join(taskDir, "meta.json"),
      stdoutLog: path.join(taskDir, "stdout.log"),
      stderrLog: path.join(taskDir, "stderr.log"),
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(taskDir, "task.md"), "# Selectable task\n\n- [ ] Do the work\n");

  const server = createControlPlaneServer(null, { stateFile });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const initialHealth = await requestJson(`${baseUrl}/api/health`);
    assert.equal(initialHealth.needsProject, true);

    const tasksBeforeProject = await fetch(`${baseUrl}/api/tasks`);
    assert.equal(tasksBeforeProject.status, 400);

    const selected = await requestJson(`${baseUrl}/api/projects/select`, {
      method: "POST",
      body: { projectRoot },
    });
    assert.equal(selected.current.projectRoot, projectRoot);

    const selectedHealth = await requestJson(`${baseUrl}/api/health`);
    assert.equal(selectedHealth.needsProject, false);
    assert.equal(selectedHealth.projectRoot, projectRoot);

    const tasks = await requestJson(`${baseUrl}/api/tasks`);
    assert.equal(tasks.items.length, 1);
    assert.equal(tasks.items[0].taskId, "task-demo");
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
