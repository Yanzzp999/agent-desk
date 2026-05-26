import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  TaskApiError,
  createSqliteAuditBridge,
  createTaskApiServer,
} from "../src/lib/task-api-server.mjs";

test("task API server exposes JSON routes through an injected store seam", async () => {
  const calls = [];
  const store = {
    async getStatus() {
      calls.push(["getStatus"]);
      return { ok: true, projectRoot: "/tmp/project", counts: { tasks: 1, sessions: 1 } };
    },
    async listTasks(query) {
      calls.push(["listTasks", query]);
      return {
        items: [
          { taskId: "task-alpha", name: "Alpha", status: "ready", sessionCount: 1 },
        ],
      };
    },
    async createTask(request) {
      calls.push(["createTask", request]);
      return { taskId: "task-created", status: "received", title: request.title };
    },
    async getTask(taskId) {
      calls.push(["getTask", taskId]);
      return { taskId, title: "Alpha", status: "ready", markdown: "# Alpha\n" };
    },
    async updateTask(taskId, patch) {
      calls.push(["updateTask", taskId, patch]);
      return { taskId, status: patch.status || "ready", title: patch.title || "Alpha" };
    },
    async claimTask(taskId, request) {
      calls.push(["claimTask", taskId, request]);
      return { taskId, claimed: [{ index: 1, claimedBy: request.assignee }] };
    },
    async dispatchTask(taskId, request) {
      calls.push(["dispatchTask", taskId, request]);
      return { taskId, sessionId: "session-alpha", status: "queued", waitedForCompletion: false };
    },
    async getTaskStatus(taskId) {
      calls.push(["getTaskStatus", taskId]);
      return { taskId, status: "running", activeSessionId: "session-alpha" };
    },
    async listAudit(taskId, query) {
      calls.push(["listAudit", taskId, query]);
      return {
        items: [
          {
            id: 1,
            taskId,
            eventType: "task.dispatch",
            actor: "worker",
            createdAt: "2026-05-25T00:00:00.000Z",
          },
        ],
      };
    },
    async getSessionSummary(taskId) {
      calls.push(["getSessionSummary", taskId]);
      return {
        taskId,
        counts: { total: 1, running: 1 },
        items: [{ sessionId: "session-alpha", status: "running" }],
      };
    },
  };
  const server = createTaskApiServer({ store, projectRoot: "/tmp/project" });
  const baseUrl = await listen(server);

  try {
    const info = await requestJson(baseUrl, "/api/agentdesk");
    assert.equal(info.status, 200);
    assert.equal(info.body.ok, true);
    assert.equal(info.body.data.viteProxy.path, "/api/agentdesk");
    assert.equal(info.body.data.staticServing.enabled, false);

    const health = await requestJson(baseUrl, "/api/agentdesk/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.data.ok, true);

    const list = await requestJson(baseUrl, "/api/agentdesk/tasks?status=ready&q=alpha");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data.items.map((item) => item.taskId), ["task-alpha"]);

    const created = await requestJson(baseUrl, "/api/agentdesk/tasks", {
      method: "POST",
      body: { title: "Created", brief: "Create a task.", similarTaskAction: "rebuild" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.taskId, "task-created");

    const detail = await requestJson(baseUrl, "/api/agentdesk/tasks/task-alpha");
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.markdown, "# Alpha\n");

    const updated = await requestJson(baseUrl, "/api/agentdesk/tasks/task-alpha", {
      method: "PATCH",
      body: { title: "Alpha edited", status: "ready" },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.title, "Alpha edited");

    const claimed = await requestJson(baseUrl, "/api/agentdesk/tasks/task-alpha/claim", {
      method: "POST",
      body: { items: [1, "Write tests"], assignee: "worker-d", sessionId: "session-alpha" },
    });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.data.claimed[0].claimedBy, "worker-d");

    const dispatched = await requestJson(baseUrl, "/api/agentdesk/tasks/task-alpha/dispatch", {
      method: "POST",
      body: { parallelism: 2, reasoning: "xhigh", subagentLauncher: "codex-app" },
    });
    assert.equal(dispatched.status, 202);
    assert.equal(dispatched.body.data.sessionId, "session-alpha");

    const status = await requestJson(baseUrl, "/api/agentdesk/tasks/task-alpha/status");
    assert.equal(status.status, 200);
    assert.equal(status.body.data.activeSessionId, "session-alpha");

    const audit = await requestJson(baseUrl, "/api/agentdesk/tasks/task-alpha/audit?limit=5");
    assert.equal(audit.status, 200);
    assert.equal(audit.body.data.items[0].eventType, "task.dispatch");

    const sessions = await requestJson(baseUrl, "/api/agentdesk/tasks/task-alpha/sessions/summary");
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.data.counts.total, 1);

    assert.deepEqual(calls, [
      ["getStatus"],
      ["listTasks", { status: "ready", q: "alpha" }],
      ["createTask", { title: "Created", brief: "Create a task.", similarTaskAction: "rebuild" }],
      ["getTask", "task-alpha"],
      ["updateTask", "task-alpha", { title: "Alpha edited", status: "ready" }],
      ["claimTask", "task-alpha", {
        items: [1, "Write tests"],
        assignee: "worker-d",
        sessionId: "session-alpha",
      }],
      ["dispatchTask", "task-alpha", {
        parallelism: 2,
        reasoning: "xhigh",
        subagentLauncher: "codex-app",
      }],
      ["getTaskStatus", "task-alpha"],
      ["listAudit", "task-alpha", { limit: 5 }],
      ["getSessionSummary", "task-alpha"],
    ]);
  } finally {
    await closeServer(server);
  }
});

test("task API server validates JSON bodies and returns consistent error envelopes", async () => {
  const store = {
    async createTask() {
      throw new Error("createTask should not be called for invalid requests");
    },
    async getTask() {
      throw new TaskApiError(404, "TASK_NOT_FOUND", "task not found");
    },
  };
  const server = createTaskApiServer({ store });
  const baseUrl = await listen(server);

  try {
    const invalidBody = await requestJson(baseUrl, "/api/agentdesk/tasks", {
      method: "POST",
      body: { brief: "Missing title" },
    });
    assert.equal(invalidBody.status, 400);
    assert.equal(invalidBody.body.ok, false);
    assert.equal(invalidBody.body.error.code, "VALIDATION_ERROR");
    assert.match(invalidBody.body.error.message, /invalid body/);

    const invalidJson = await fetch(`${baseUrl}/api/agentdesk/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const invalidJsonBody = await invalidJson.json();
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJsonBody.error.code, "INVALID_JSON");

    const missing = await requestJson(baseUrl, "/api/agentdesk/tasks/missing-task");
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, {
      ok: false,
      error: {
        code: "TASK_NOT_FOUND",
        message: "task not found",
      },
    });
  } finally {
    await closeServer(server);
  }
});

test("SQLite audit bridge records and filters task API events", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-api-sqlite-"));
  const audit = await createSqliteAuditBridge({
    sqlitePath: path.join(root, "audit.sqlite"),
  });

  try {
    await audit.record({
      taskId: "task-alpha",
      eventType: "task.create",
      actor: "worker-d",
      request: { brief: "Create alpha." },
      result: { taskId: "task-alpha", status: "ready" },
      createdAt: "2026-05-25T00:00:01.000Z",
    });
    await audit.record({
      taskId: "task-beta",
      eventType: "task.create",
      actor: "worker-e",
      request: { brief: "Create beta." },
      result: { taskId: "task-beta", status: "ready" },
      createdAt: "2026-05-25T00:00:02.000Z",
    });
    await audit.record({
      taskId: "task-alpha",
      eventType: "task.dispatch",
      actor: "worker-d",
      request: { parallelism: 2 },
      result: { sessionId: "session-alpha" },
      createdAt: "2026-05-25T00:00:03.000Z",
    });

    const result = await audit.list({ taskId: "task-alpha", limit: 10 });
    assert.deepEqual(
      result.items.map((item) => item.eventType),
      ["task.dispatch", "task.create"],
    );
    assert.equal(result.items[0].request.parallelism, 2);
    assert.equal(result.items[1].result.status, "ready");
  } finally {
    await audit.close();
  }
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
