import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_DESK_STATE_DIRNAME,
  buildCodexExecArgs,
  buildCodexInteractiveArgs,
  chooseExecutionModeForTask,
  createContext,
  createTask,
  getAgentLogs,
  getSession,
  getTask,
  listSessions,
  listTasks,
  normalizeSessionRequest,
  parseAgentDeskConfigToml,
  parseTaskMarkdownItems,
  readableTaskSlug,
  renderAgentDeskConfigToml,
  renderSessionDocument,
  upsertTaskMemoryEntry,
} from "../src/lib/control-plane.mjs";

test("createContext uses project-scoped .agent-desk roots", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-context-"));
  const context = createContext({ projectRoot });

  assert.equal(context.projectRoot, projectRoot);
  assert.equal(context.deskRoot, path.join(projectRoot, AGENT_DESK_STATE_DIRNAME));
  assert.equal(context.tasksRoot, path.join(projectRoot, AGENT_DESK_STATE_DIRNAME, "tasks"));
  assert.equal(context.sessionsRoot, path.join(projectRoot, AGENT_DESK_STATE_DIRNAME, "sessions"));
  assert.match(context.worktreesRoot, /agent-desk\/worktrees/);
});

test("builds readable English slugs for Chinese AgentDesk task names", () => {
  assert.equal(
    readableTaskSlug("AgentDesk \u4efb\u52a1\u9886\u53d6\u4e0e\u53cc\u542f\u52a8\u5668\u9a8c\u8bc1"),
    "agentdesk-task-claim-dual-launcher-validation",
  );
  assert.equal(
    readableTaskSlug("Codex CLI \u542f\u52a8\u70df\u6d4b"),
    "codex-cli-launch-smoke-test",
  );
  assert.equal(
    readableTaskSlug("\u4efb\u52a1\u9886\u53d6\u4e0e\u53cc\u542f\u52a8\u5668\u9a8c\u8bc1"),
    "task-claim-dual-launcher-validation",
  );
});

test("createTask requires confirmation before duplicating a similar AgentDesk task", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-confirm-"));
  const context = createContext({ projectRoot });
  const taskDir = path.join(context.tasksRoot, "task-existing-checkout-flow");
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, "meta.json"), JSON.stringify({
    schemaVersion: 2,
    taskId: "task-existing-checkout-flow",
    title: "Checkout flow",
    brief: "Implement checkout end to end.",
    status: "ready",
    createdAt: "2026-05-13T10:00:00.000Z",
    updatedAt: "2026-05-13T10:05:00.000Z",
    completedAt: "2026-05-13T10:05:00.000Z",
    lastError: "",
    subtaskCount: 2,
    paths: {
      taskDir,
      briefMd: path.join(taskDir, "brief.md"),
      promptMd: path.join(taskDir, "prompt.md"),
      taskMd: path.join(taskDir, "task.md"),
      memoryMd: path.join(taskDir, "memory.md"),
      metaJson: path.join(taskDir, "meta.json"),
      stdoutLog: path.join(taskDir, "stdout.log"),
      stderrLog: path.join(taskDir, "stderr.log"),
    },
  }, null, 2), "utf8");

  const blocked = await createTask(context, {
    title: "Checkout flow",
    brief: "Implement checkout end to end.",
  });
  assert.equal(blocked.requiresConfirmation, true);
  assert.equal(blocked.similarTasks[0].taskId, "task-existing-checkout-flow");

  const continued = await createTask(context, {
    title: "Checkout flow",
    brief: "Implement checkout end to end.",
    similarTaskAction: "continue",
  });
  assert.equal(continued.reusedExistingTask, true);
  assert.equal(continued.taskId, "task-existing-checkout-flow");
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
    brief: "Replace the old Verune workflow with task/session orchestration.",
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
  await fs.writeFile(path.join(taskDir, "memory.md"), "# Task Memory\n\nExisting shared context.\n");
  await fs.writeFile(sessionMeta.paths.metaJson, `${JSON.stringify(sessionMeta, null, 2)}\n`);
  await fs.writeFile(sessionMeta.paths.docMd, renderSessionDocument(sessionMeta, taskMeta));
  await fs.writeFile(sessionMeta.agents[0].paths.stdoutLog, "stdout line\n");
  await fs.writeFile(sessionMeta.agents[0].paths.stderrLog, "stderr line\n");

  const context = createContext({ projectRoot });
  const tasks = await listTasks(context);
  assert.equal(tasks.items.length, 1);
  assert.equal(tasks.items[0].taskId, "task-demo");
  assert.equal(tasks.items[0].name, "Ship AgentDesk orchestration");
  assert.equal(tasks.items[0].sessionCount, 1);

  const taskDetail = await getTask(context, "task-demo");
  assert.match(taskDetail.markdown, /Replace PRD JSON generation/);
  assert.match(taskDetail.memory, /Existing shared context/);
  assert.equal(taskDetail.memoryPath, path.join(taskDir, "memory.md"));
  assert.equal(taskDetail.sessions.length, 1);

  const sessions = await listSessions(context);
  assert.equal(sessions.items.length, 1);
  assert.equal(sessions.items[0].name, "Ship AgentDesk orchestration");
  assert.equal(sessions.items[0].taskTitle, "Ship AgentDesk orchestration");

  const sessionDetail = await getSession(context, "session-demo");
  assert.equal(sessionDetail.name, "Ship AgentDesk orchestration");
  assert.match(sessionDetail.docContent, /Session ID: session-demo/);

  const logs = await getAgentLogs(context, "session-demo", "agent-01");
  assert.match(logs.stdout, /stdout line/);
  assert.match(logs.stderr, /stderr line/);
});

test("lists historical sessions newest first and reads detail/log summaries", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-history-"));
  const context = createContext({ projectRoot });
  const task = await writeTaskState(projectRoot, {
    taskId: "task-history",
    title: "Check session history",
  });

  await writeSessionState(projectRoot, task, {
    sessionId: "session-old",
    status: "failed",
    updatedAt: "2026-05-15T08:00:00.000Z",
    completedAt: "2026-05-15T08:00:00.000Z",
    agentStatus: "failed",
    agentSummary: "Earlier history read failed.",
    lastError: "synthetic historical failure",
    stdout: "old stdout line\n",
    stderr: "old stderr line\n",
  });
  await writeSessionState(projectRoot, task, {
    sessionId: "session-latest",
    status: "succeeded",
    updatedAt: "",
    completedAt: "2026-05-15T09:00:00.000Z",
    agentStatus: "succeeded",
    agentSummary: "Session history detail verified.",
    stdout: "latest stdout line\n",
    stderr: "latest stderr line\n",
    writeDoc: false,
  });

  const sessions = await listSessions(context, { taskId: "task-history" });
  assert.deepEqual(sessions.items.map((session) => session.sessionId), [
    "session-latest",
    "session-old",
  ]);
  assert.equal(sessions.items[0].status, "succeeded");
  assert.equal(sessions.items[0].name, "Check session history");
  assert.equal(sessions.items[0].taskTitle, "Check session history");
  assert.equal(sessions.items[1].lastError, "synthetic historical failure");

  const detail = await getSession(context, "session-latest");
  assert.equal(detail.task.title, "Check session history");
  assert.equal(detail.name, "Check session history");
  assert.equal(detail.status, "succeeded");
  assert.equal(detail.agents[0].status, "succeeded");
  assert.equal(detail.agents[0].summary, "Session history detail verified.");
  assert.match(detail.docContent, /Session ID: session-latest/);
  assert.match(detail.docContent, /Summary: Session history detail verified\./);

  const logs = await getAgentLogs(context, "session-latest", "agent-01");
  assert.match(logs.stdout, /latest stdout line/);
  assert.match(logs.stderr, /latest stderr line/);
});

test("upserts task memory entries by session and agent marker", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-memory-"));
  const context = createContext({ projectRoot });
  const taskDir = path.join(context.tasksRoot, "task-memory");
  const task = {
    taskId: "task-memory",
    title: "Remember agent work",
    createdAt: "2026-05-14T00:00:00.000Z",
    paths: {
      taskDir,
      memoryMd: path.join(taskDir, "memory.md"),
    },
  };

  await fs.mkdir(taskDir, { recursive: true });
  const first = await upsertTaskMemoryEntry(context, task, "session-a", {
    id: "agent-01",
    title: "Implement memory",
    status: "succeeded",
    completedAt: "2026-05-14T01:00:00.000Z",
    summary: "Initial summary",
    changedFiles: ["src/lib/control-plane.mjs"],
    testsRun: ["npm test"],
    risks: [],
    notes: ["First note"],
    lastError: "",
  });
  const second = await upsertTaskMemoryEntry(context, task, "session-a", {
    id: "agent-01",
    title: "Implement memory",
    status: "succeeded",
    completedAt: "2026-05-14T01:05:00.000Z",
    summary: "Updated summary",
    changedFiles: ["src/lib/control-plane.mjs"],
    testsRun: ["npm test"],
    risks: ["Watch stale context"],
    notes: ["Updated note"],
    lastError: "",
  });

  assert.match(first.memory, /Initial summary/);
  assert.match(second.memory, /Updated summary/);
  assert.doesNotMatch(second.memory, /Initial summary/);
  assert.equal(second.memory.match(/<!-- agentdesk-memory:session-a:agent-01 -->/g).length, 1);
});

test("normalizes configurable session defaults and overrides", () => {
  assert.deepEqual(normalizeSessionRequest(), {
    parallelism: 6,
    model: "gpt-5.5",
    reasoning: "xhigh",
    serviceTier: "fast",
    executionMode: "auto",
    subagentLauncher: "codex-cli",
    launchPrompt: "",
  });

  assert.deepEqual(normalizeSessionRequest({
    parallelism: "2",
    model: "gpt-5.4",
    reasoning: "high",
    executionMode: "current-branch",
    subagentLauncher: "codex-cli",
    launchPrompt: "Prefer small patches",
  }), {
    parallelism: 2,
    model: "gpt-5.4",
    reasoning: "high",
    serviceTier: "fast",
    executionMode: "current-branch",
    subagentLauncher: "codex-cli",
    launchPrompt: "Prefer small patches",
  });

  assert.equal(normalizeSessionRequest({ parallelism: "999" }).parallelism, 24);
  assert.throws(() => normalizeSessionRequest({ parallelism: "0" }), /positive number/);
  assert.throws(() => normalizeSessionRequest({ model: "bad model" }), /single Codex CLI model id/);
  assert.throws(() => normalizeSessionRequest({ reasoning: "extreme" }), /unsupported reasoning effort/);
  assert.equal(normalizeSessionRequest({ executionMode: "current-branch" }).subagentLauncher, "codex-cli");
  assert.throws(() => normalizeSessionRequest({ executionMode: "sidecar" }), /unsupported execution mode/);
});

test("chooses worktrees only when auto mode sees useful isolation", () => {
  const single = chooseExecutionModeForTask(`
# Small docs fix

## Subtasks
- [ ] Update README.md copy
`, normalizeSessionRequest());
  assert.equal(single.executionMode, "current-branch");
  assert.equal(single.requiresWorktree, false);

  const disjoint = chooseExecutionModeForTask(`
# Split UI and CLI edits

## Subtasks
- [ ] Update src/cli/help.mjs
- [ ] Update src/ui/session-panel.tsx
`, normalizeSessionRequest({ parallelism: 2 }));
  assert.equal(disjoint.executionMode, "current-branch");
  assert.equal(disjoint.requiresWorktree, false);

  const overlapping = chooseExecutionModeForTask(`
# Shared config update

## Subtasks
- [ ] Update src/lib/control-plane.mjs request parsing
- [ ] Update src/lib/control-plane.mjs session docs
`, normalizeSessionRequest({ parallelism: 2 }));
  assert.equal(overlapping.executionMode, "worktree");
  assert.equal(overlapping.requiresWorktree, true);

  const explicit = chooseExecutionModeForTask(`
# Explicit isolation

## Subtasks
- [ ] Update README.md
`, normalizeSessionRequest({ executionMode: "worktree" }));
  assert.equal(explicit.executionMode, "worktree");
  assert.equal(explicit.requiresWorktree, true);
});

test("parses and renders TOML session config", () => {
  const parsed = parseAgentDeskConfigToml(`
[session]
model = "gpt-5.4"
reasoning = "high"
parallelism = 3
execution_mode = "current-branch"
subagent_launcher = "codex-cli"
`);

  assert.deepEqual(normalizeSessionRequest(parsed.session), {
    parallelism: 3,
    model: "gpt-5.4",
    reasoning: "high",
    serviceTier: "fast",
    executionMode: "current-branch",
    subagentLauncher: "codex-cli",
    launchPrompt: "",
  });

  const rendered = renderAgentDeskConfigToml({ session: parsed.session });
  assert.match(rendered, /\[session\]/);
  assert.match(rendered, /model = "gpt-5\.4"/);
  assert.match(rendered, /execution_mode = "current-branch"/);
  assert.match(rendered, /subagent_launcher = "codex-cli"/);
});

test("builds Codex exec args with selected model, reasoning, service tier, and output schema", () => {
  assert.deepEqual(buildCodexExecArgs({
    cwd: "/tmp/project-worktree",
    model: "gpt-5.5",
    reasoning: "high",
    serviceTier: "fast",
    outputFile: "/tmp/report.json",
    outputSchemaFile: "/tmp/schema.json",
  }), [
    "-a",
    "never",
    "exec",
    "-m",
    "gpt-5.5",
    "--config",
    "model_reasoning_effort=\"high\"",
    "--config",
    "model_provider.service_tier=fast",
    "-s",
    "danger-full-access",
    "-C",
    "/tmp/project-worktree",
    "-o",
    "/tmp/report.json",
    "--output-schema",
    "/tmp/schema.json",
    "-",
  ]);
});

test("builds Codex interactive args for resumable subagents", () => {
  const args = buildCodexInteractiveArgs({
    cwd: "/tmp/project-worktree",
    model: "gpt-5.5",
    reasoning: "high",
    serviceTier: "fast",
    sandboxMode: "workspace-write",
    prompt: "Implement the assigned task.",
  });

  assert.equal(args.includes("exec"), false);
  assert.equal(args.includes("-o"), false);
  assert.equal(args.includes("--output-schema"), false);
  assert.deepEqual(args, [
    "-a",
    "never",
    "-m",
    "gpt-5.5",
    "--config",
    "model_reasoning_effort=\"high\"",
    "--config",
    "model_provider.service_tier=fast",
    "-s",
    "workspace-write",
    "-C",
    "/tmp/project-worktree",
    "--no-alt-screen",
    "Implement the assigned task.",
  ]);
});

async function writeTaskState(projectRoot, options) {
  const taskDir = path.join(projectRoot, ".agent-desk", "tasks", options.taskId);
  const taskMd = path.join(taskDir, "task.md");
  const memoryMd = path.join(taskDir, "memory.md");
  const metaJson = path.join(taskDir, "meta.json");
  const task = {
    schemaVersion: 2,
    taskId: options.taskId,
    title: options.title,
    brief: "Verify historical session state.",
    status: "ready",
    createdAt: "2026-05-15T07:00:00.000Z",
    updatedAt: "2026-05-15T07:00:00.000Z",
    completedAt: "2026-05-15T07:00:00.000Z",
    lastError: "",
    subtaskCount: 1,
    paths: {
      taskDir,
      briefMd: path.join(taskDir, "brief.md"),
      promptMd: path.join(taskDir, "prompt.md"),
      taskMd,
      memoryMd,
      metaJson,
      stdoutLog: path.join(taskDir, "stdout.log"),
      stderrLog: path.join(taskDir, "stderr.log"),
    },
  };
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(task.paths.briefMd, "Verify historical session state.\n", "utf8");
  await fs.writeFile(task.paths.taskMd, `# ${options.title}\n\n- [ ] Read historical session\n`, "utf8");
  await fs.writeFile(task.paths.memoryMd, "# Task Memory\n\nExisting session history context.\n", "utf8");
  await fs.writeFile(task.paths.stdoutLog, "", "utf8");
  await fs.writeFile(task.paths.stderrLog, "", "utf8");
  await fs.writeFile(task.paths.metaJson, `${JSON.stringify(task, null, 2)}\n`, "utf8");
  return task;
}

async function writeSessionState(projectRoot, task, options) {
  const sessionDir = path.join(projectRoot, ".agent-desk", "sessions", options.sessionId);
  const agentDir = path.join(sessionDir, "agents", "agent-01");
  const createdAt = options.createdAt || "2026-05-15T07:30:00.000Z";
  const completedAt = options.completedAt || createdAt;
  const updatedAt = options.updatedAt ?? completedAt;
  const metaJson = path.join(sessionDir, "meta.json");
  const docMd = path.join(sessionDir, "session.md");
  const stdoutLog = path.join(sessionDir, "stdout.log");
  const stderrLog = path.join(sessionDir, "stderr.log");
  const agent = {
    id: "agent-01",
    order: 1,
    title: "Read historical session",
    detail: "",
    status: options.agentStatus || options.status,
    branchName: "current-branch",
    worktreePath: projectRoot,
    baseCommit: "abc123",
    headCommit: "def456",
    mergedCommit: "",
    changedFiles: ["src/lib/control-plane.mjs"],
    testsRun: ["node --test test/state-reader.test.mjs"],
    risks: [],
    notes: ["Historical session fixture."],
    summary: options.agentSummary || "",
    startedAt: createdAt,
    updatedAt,
    completedAt,
    exitCode: options.status === "failed" ? 1 : 0,
    lastError: options.lastError || "",
    paths: {
      agentDir,
      promptMd: path.join(agentDir, "prompt.md"),
      reportJson: path.join(agentDir, "report.json"),
      stdoutLog: path.join(agentDir, "stdout.log"),
      stderrLog: path.join(agentDir, "stderr.log"),
    },
  };
  const meta = {
    schemaVersion: 2,
    sessionId: options.sessionId,
    taskId: task.taskId,
    title: task.title,
    status: options.status,
    parallelism: 1,
    batchSize: 6,
    model: "gpt-5.5",
    reasoning: "xhigh",
    serviceTier: "fast",
    executionMode: "current-branch",
    subagentLauncher: "codex-cli",
    launchPrompt: "",
    createdAt,
    updatedAt,
    startedAt: createdAt,
    completedAt,
    lastError: options.lastError || "",
    totalAgents: 1,
    succeededAgents: options.status === "succeeded" ? 1 : 0,
    failedAgents: options.status === "failed" ? 1 : 0,
    runningAgents: 0,
    agents: [agent],
    paths: {
      sessionDir,
      metaJson,
      docMd,
      stdoutLog,
      stderrLog,
    },
  };
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(metaJson, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  if (options.writeDoc !== false) {
    await fs.writeFile(docMd, renderSessionDocument(meta, task), "utf8");
  }
  await fs.writeFile(stdoutLog, "", "utf8");
  await fs.writeFile(stderrLog, "", "utf8");
  await fs.writeFile(agent.paths.promptMd, "# Prompt\n", "utf8");
  await fs.writeFile(agent.paths.stdoutLog, options.stdout || "", "utf8");
  await fs.writeFile(agent.paths.stderrLog, options.stderr || "", "utf8");
}
