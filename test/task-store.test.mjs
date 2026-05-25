import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  backfillTaskMarkdownSources,
  openTaskStore,
  registerTaskMarkdown,
  resolveTaskStoreDbPath,
  TASK_STORE_SCHEMA_VERSION,
} from "../src/lib/task-store.mjs";

const NOW = "2026-05-25T00:00:00.000Z";

test("opens the task store under .agent-desk and creates audited overall tasks", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-store-"));
  const store = openTaskStore({
    projectRoot,
    now: () => NOW,
  });
  try {
    assert.equal(store.dbPath, path.join(projectRoot, ".agent-desk", "tasks.sqlite"));
    assert.equal(resolveTaskStoreDbPath({ projectRoot }), store.dbPath);
    assert.equal(store.getSchemaVersion(), TASK_STORE_SCHEMA_VERSION);
    assert.ok(await exists(store.dbPath));

    const task = store.createTask({
      id: "task-checkout",
      title: "Checkout flow",
      description: "Implement checkout end to end.",
      taskType: "feature",
      periodType: "week",
      periodKey: "2026-W22",
      status: "ready",
      priority: 7,
      assignee: "worker-a",
      projectRoot,
      branch: "codex/checkout-flow",
      dueAt: "2026-06-01T00:00:00.000Z",
    });

    assert.equal(task.id, "task-checkout");
    assert.equal(task.title, "Checkout flow");
    assert.equal(task.periodType, "week");
    assert.equal(task.periodKey, "2026-W22");
    assert.equal(task.priority, 7);
    assert.equal(task.createdAt, NOW);
    assert.equal(task.updatedAt, NOW);

    const listed = store.listTasks({ projectRoot, status: "ready" });
    assert.deepEqual(listed.map((item) => item.id), ["task-checkout"]);

    const audit = store.getAuditEvents("task-checkout");
    assert.deepEqual(audit.map((event) => event.eventType), ["create"]);
    assert.equal(audit[0].changes.after.title, "Checkout flow");
  } finally {
    store.close();
  }
});

test("claim and dispatch operations are transactional and conflict aware", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-store-"));
  const store = openTaskStore({
    projectRoot,
    dbPath: path.join(projectRoot, ".agent-desk", "deterministic-test.sqlite"),
    now: () => NOW,
  });
  try {
    store.createTask({
      id: "task-claim-dispatch",
      title: "Claim and dispatch",
      status: "ready",
      projectRoot,
    });

    const claimed = store.claimTask("task-claim-dispatch", {
      assignee: "worker-a",
      sessionId: "session-a",
      now: "2026-05-25T01:00:00.000Z",
    });
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.claimedBy, "worker-a");
    assert.equal(claimed.claimSessionId, "session-a");

    assert.throws(
      () => store.claimTask("task-claim-dispatch", {
        assignee: "worker-b",
        sessionId: "session-b",
      }),
      /task already claimed by worker-a\/session-a/,
    );
    assert.equal(store.getTask("task-claim-dispatch").claimedBy, "worker-a");

    assert.throws(
      () => store.dispatchTask("task-claim-dispatch", {
        assignee: "worker-a",
        sessionId: "session-b",
      }),
      /claimed by session session-a/,
    );

    const dispatched = store.dispatchTask("task-claim-dispatch", {
      assignee: "worker-a",
      sessionId: "session-a",
      branch: "codex/worker-a",
      now: "2026-05-25T02:00:00.000Z",
    });
    assert.equal(dispatched.status, "dispatched");
    assert.equal(dispatched.dispatchSessionId, "session-a");
    assert.equal(dispatched.branch, "codex/worker-a");

    assert.throws(
      () => store.dispatchTask("task-claim-dispatch", {
        assignee: "worker-a",
        sessionId: "session-c",
      }),
      /already dispatched to session session-a/,
    );
    assert.equal(store.getTask("task-claim-dispatch").dispatchSessionId, "session-a");

    const events = store.getAuditEvents("task-claim-dispatch");
    assert.deepEqual(events.map((event) => event.eventType), [
      "create",
      "claim",
      "status_change",
      "dispatch",
      "status_change",
    ]);
    assert.equal(events[1].changes.claimedBy.after, "worker-a");
    assert.equal(events[3].changes.dispatchSessionId.after, "session-a");
  } finally {
    store.close();
  }
});

test("updates validate final period state and record audit events", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-store-"));
  const store = openTaskStore({ projectRoot, now: () => NOW });
  try {
    store.createTask({
      id: "task-period",
      title: "Period task",
      periodType: "month",
      periodKey: "2026-05",
      projectRoot,
    });

    assert.throws(
      () => store.updateTask("task-period", { periodKey: "" }),
      /periodKey is required/,
    );

    const updated = store.updateTask("task-period", {
      periodType: "none",
      periodKey: "",
      status: "blocked",
    }, {
      actor: "planner",
      now: "2026-05-25T03:00:00.000Z",
    });

    assert.equal(updated.periodType, "none");
    assert.equal(updated.periodKey, "");
    assert.equal(updated.status, "blocked");

    const events = store.getAuditEvents("task-period");
    assert.deepEqual(events.map((event) => event.eventType), ["create", "update", "status_change"]);
    assert.equal(events[1].changes.periodType.after, "none");
    assert.equal(events[2].changes.status.after, "blocked");
  } finally {
    store.close();
  }
});

test("registers and backfills markdown task sources without replacing markdown", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-store-"));
  const agentDeskTaskDir = path.join(projectRoot, ".agent-desk", "tasks", "task-demo");
  const projectTaskDir = path.join(projectRoot, "task");
  const agentDeskTaskMd = path.join(agentDeskTaskDir, "task.md");
  const projectTaskMd = path.join(projectTaskDir, "manual.task.md");
  const agentDeskMarkdown = "# Generated AgentDesk task\n\n- [ ] Implement model\n";
  const projectMarkdown = "# Manual project task\n\n## Goal\nKeep task.md readable.\n\n- [ ] Write API tests\n";

  await fs.mkdir(agentDeskTaskDir, { recursive: true });
  await fs.mkdir(projectTaskDir, { recursive: true });
  await fs.writeFile(agentDeskTaskMd, agentDeskMarkdown, "utf8");
  await fs.writeFile(path.join(agentDeskTaskDir, "meta.json"), JSON.stringify({
    taskId: "task-demo",
    title: "Generated task from meta",
    brief: "Use the existing AgentDesk task.md as the source.",
    status: "ready",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T01:00:00.000Z",
  }, null, 2));
  await fs.writeFile(projectTaskMd, projectMarkdown, "utf8");

  const store = openTaskStore({ projectRoot, now: () => NOW });
  try {
    const registered = await registerTaskMarkdown(store, {
      projectRoot,
      sourcePath: agentDeskTaskMd,
      now: "2026-05-25T04:00:00.000Z",
    });
    assert.equal(registered.id, "task-demo");
    assert.equal(registered.title, "Generated task from meta");
    assert.equal(registered.sourceType, "agent-desk-task-md");
    assert.equal(registered.status, "ready");

    const backfilled = await backfillTaskMarkdownSources(store, {
      projectRoot,
      now: "2026-05-25T05:00:00.000Z",
    });
    assert.equal(backfilled.count, 2);
    assert.deepEqual(store.listTasks({ projectRoot }).map((task) => task.id).sort(), [
      "task-demo",
      store.getTaskBySourcePath(projectTaskMd).id,
    ].sort());

    const projectTask = store.getTaskBySourcePath(projectTaskMd);
    assert.equal(projectTask.title, "Manual project task");
    assert.equal(projectTask.description, "Keep task.md readable.");
    assert.equal(projectTask.sourceType, "project-task-md");
    assert.ok(projectTask.id.startsWith("task-md-manual-project-task-"));

    const afterMarkdown = await fs.readFile(projectTaskMd, "utf8");
    assert.equal(afterMarkdown, projectMarkdown);

    const secondBackfill = await backfillTaskMarkdownSources(store, {
      projectRoot,
      now: "2026-05-25T06:00:00.000Z",
    });
    assert.equal(secondBackfill.count, 2);
    assert.equal(store.listTasks({ projectRoot }).length, 2);

    const events = store.getAuditEvents("task-demo");
    assert.ok(events.some((event) => event.eventType === "register"));
    assert.ok(events.some((event) => event.eventType === "backfill"));
  } finally {
    store.close();
  }
});

async function exists(filePath) {
  return Boolean(await fs.stat(filePath).catch(() => null));
}
