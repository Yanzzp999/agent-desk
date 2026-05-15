import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");
const MCP_BIN = path.join(REPO_ROOT, "bin", "agent-desk-mcp.mjs");

test("MCP server runs markdown task tools against the launched project", async () => {
  const projectRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-")));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const expectedTools = [
      "claim_task_items",
      "create_agentdesk_task",
      "create_task",
      "list_agentdesk_tasks",
      "list_subagent_sessions",
      "list_tasks",
      "read_agentdesk_task",
      "read_subagent_session",
      "read_task",
      "start_subagent_session",
    ];
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      expectedTools,
    );

    const created = await client.callTool({
      name: "create_task",
      arguments: {
        title: "MCP task generation",
        brief: "Create a portable task file.",
        tasks: ["Expose MCP entrypoint", "Write task markdown"],
      },
    });

    assert.equal(created.structuredContent.filename, "mcp-task-generation.task.md");
    assert.equal(created.structuredContent.taskDir, path.join(projectRoot, "task"));
    assert.match(created.structuredContent.markdown, /^- \[ \] Expose MCP entrypoint/m);

    const generatedText = await fs.readFile(
      path.join(projectRoot, "task", "mcp-task-generation.task.md"),
      "utf8",
    );
    assert.equal(generatedText, created.structuredContent.markdown);

    const listedBeforeClaim = await client.callTool({
      name: "list_tasks",
      arguments: {},
    });

    assert.equal(listedBeforeClaim.structuredContent.projectRoot, projectRoot);
    assert.equal(listedBeforeClaim.structuredContent.taskDir, path.join(projectRoot, "task"));
    assert.equal(listedBeforeClaim.structuredContent.items.length, 1);
    assert.equal(listedBeforeClaim.structuredContent.items[0].filename, "mcp-task-generation.task.md");
    assert.equal(listedBeforeClaim.structuredContent.items[0].title, "MCP task generation");
    assert.equal(listedBeforeClaim.structuredContent.items[0].taskCount, 2);
    assert.equal(listedBeforeClaim.structuredContent.items[0].openCount, 2);
    assert.equal(listedBeforeClaim.structuredContent.items[0].claimedCount, 0);
    assert.equal(listedBeforeClaim.structuredContent.items[0].items[1].title, "Write task markdown");

    const claimed = await client.callTool({
      name: "claim_task_items",
      arguments: {
        taskName: "MCP task generation",
        items: [1, "Write task"],
        assignee: "mcp-agent",
        note: "manual session",
      },
    });

    assert.equal(claimed.structuredContent.claimed.length, 2);
    assert.equal(claimed.structuredContent.claimedCount, 2);
    assert.equal(claimed.structuredContent.items[0].claimedBy, "mcp-agent");
    assert.match(claimed.structuredContent.markdown, /AgentDesk claim: `mcp-agent`/);
    assert.match(claimed.structuredContent.markdown, /note: manual session/);

    const listedAfterClaim = await client.callTool({
      name: "list_tasks",
      arguments: {
        projectRoot,
      },
    });

    assert.equal(listedAfterClaim.structuredContent.items.length, 1);
    assert.equal(listedAfterClaim.structuredContent.items[0].claimedCount, 2);
    assert.equal(listedAfterClaim.structuredContent.items[0].items[0].claimedBy, "mcp-agent");
    assert.equal(listedAfterClaim.structuredContent.items[0].items[1].claimNote, "manual session");

    const read = await client.callTool({
      name: "read_task",
      arguments: {
        taskName: "mcp-task-generation",
      },
    });

    assert.equal(read.structuredContent.claimedCount, 2);
    assert.equal(read.structuredContent.items[1].claimNote, "manual session");
    assert.equal(read.structuredContent.markdown, claimed.structuredContent.markdown);

    const fileText = await fs.readFile(
      path.join(projectRoot, "task", "mcp-task-generation.task.md"),
      "utf8",
    );
    assert.equal(fileText, claimed.structuredContent.markdown);
  } finally {
    await client.close();
  }
});

test("MCP server starts Codex CLI subagent sessions", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-session-")));
  const projectRoot = path.join(root, "project");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  const fakeState = path.join(root, "fake-state.json");
  const fakeLog = path.join(root, "fake-log.jsonl");
  await fs.mkdir(projectRoot, { recursive: true });
  await initializeGitProject(projectRoot);
  await writeReadyAgentDeskTask(projectRoot, "task-mcp-cli", "MCP CLI fanout", [
    "Inspect API surface",
    "Validate session launcher",
    "Summarize verification",
    "Check prompt snapshots",
    "Verify memory injection",
    "Assert session counts",
    "Confirm parallelism cap",
  ]);
  await writeFakeCodex(fakeCodex);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    env: {
      ...process.env,
      FAKE_CODEX_STATE: fakeState,
      FAKE_CODEX_LOG: fakeLog,
      FAKE_CODEX_DELAY_MS: "700",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-session-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const task = await client.callTool({
      name: "read_agentdesk_task",
      arguments: {
        projectRoot,
        taskId: "task-mcp-cli",
      },
    });
    assert.match(task.structuredContent.memory, /Existing MCP memory/);
    assert.equal(task.structuredContent.memoryPath, path.join(projectRoot, ".agent-desk", "tasks", "task-mcp-cli", "memory.md"));

    const started = await client.callTool({
      name: "start_subagent_session",
      arguments: {
        projectRoot,
        taskId: "task-mcp-cli",
        codexCli: fakeCodex,
        executionMode: "current-branch",
        subagentLauncher: "codex-cli",
        parallelism: 5,
      },
    });

    assert.equal(started.structuredContent.subagentLauncher, "codex-cli");
    assert.equal(started.structuredContent.requiresHostLaunch, false);
    assert.equal(started.structuredContent.waitedForCompletion, true);
    assert.equal(started.structuredContent.parallelism, 5);
    assert.equal(started.structuredContent.status, "succeeded", started.structuredContent.lastError);
    assert.equal(started.structuredContent.model, "gpt-5.5");
    assert.equal(started.structuredContent.reasoning, "xhigh");
    assert.equal(started.structuredContent.serviceTier, "fast");
    assert.equal(started.structuredContent.totalAgents, 7);
    assert.equal(started.structuredContent.succeededAgents, 7);
    assert.equal(started.structuredContent.failedAgents, 0);
    assert.equal(started.structuredContent.runningAgents, 0);
    assert.equal(started.structuredContent.executionMode, "current-branch");

    const sessionId = started.structuredContent.sessionId;
    const meta = JSON.parse(await fs.readFile(
      path.join(projectRoot, ".agent-desk", "sessions", sessionId, "meta.json"),
      "utf8",
    ));
    assert.equal(meta.status, "succeeded", meta.lastError);
    assert.equal(meta.totalAgents, 7);
    assert.equal(meta.succeededAgents, 7);
    assert.equal(meta.failedAgents, 0);
    assert.equal(meta.runningAgents, 0);
    assert.equal(meta.executionMode, "current-branch");
    assert.equal(meta.subagentLauncher, "codex-cli");
    assert.match(await fs.readFile(meta.agents[0].paths.taskSnapshotMd, "utf8"), /Inspect API surface/);
    assert.match(await fs.readFile(meta.agents[0].paths.memorySnapshotMd, "utf8"), /Existing MCP memory/);
    const firstPrompt = await fs.readFile(meta.agents[0].paths.promptMd, "utf8");
    assert.match(firstPrompt, /Execution model: gpt-5\.5/);
    assert.match(firstPrompt, /Execution reasoning: xhigh/);
    assert.match(firstPrompt, /Execution mode: current-branch/);
    assert.match(firstPrompt, /Subagent launcher: codex-cli/);
    assert.match(firstPrompt, /Assigned subtask: Inspect API surface/);
    assert.match(firstPrompt, /Shared task memory snapshot:/);
    assert.match(firstPrompt, /Existing MCP memory/);

    const state = JSON.parse(await fs.readFile(fakeState, "utf8"));
    assert.equal(state.maxActive <= 5, true);
    assert.equal(state.maxActive > 1, true);
    const invocations = await readJsonLines(fakeLog);
    const subagentInvocations = invocations.filter((entry) => entry.hasOutputSchema);
    assert.equal(subagentInvocations.length, 7);
    const invocationsByOutput = new Map(subagentInvocations.map((entry) => [entry.outputFile, entry]));
    for (const agent of meta.agents) {
      const prompt = await fs.readFile(agent.paths.promptMd, "utf8");
      assert.equal(invocationsByOutput.get(agent.paths.reportJson)?.prompt, `${prompt}\n`);
    }
    for (const entry of subagentInvocations) {
      assert.equal(entry.model, "gpt-5.5");
      assert.deepEqual(entry.configs, [
        "model_reasoning_effort=\"xhigh\"",
        "service_tier=\"fast\"",
      ]);
    }
  } finally {
    await client.close();
  }
});

test("MCP server reports actionable Codex CLI session failures", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-session-fail-")));
  const projectRoot = path.join(root, "project");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  await fs.mkdir(projectRoot, { recursive: true });
  await initializeGitProject(projectRoot);
  await writeReadyAgentDeskTask(projectRoot, "task-mcp-failure", "MCP failed fanout", ["Trigger fake Codex failure"]);
  await writeFakeCodex(fakeCodex);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    env: {
      ...process.env,
      FAKE_CODEX_FAIL_MESSAGE: "synthetic fake Codex failure",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-session-failure-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const started = await client.callTool({
      name: "start_subagent_session",
      arguments: {
        projectRoot,
        taskId: "task-mcp-failure",
        codexCli: fakeCodex,
        executionMode: "current-branch",
        subagentLauncher: "codex-cli",
      },
    });

    assert.equal(started.structuredContent.status, "failed");
    assert.equal(started.structuredContent.requiresHostLaunch, false);
    assert.equal(started.structuredContent.waitedForCompletion, true);
    assert.equal(started.structuredContent.totalAgents, 1);
    assert.equal(started.structuredContent.failedAgents, 1);
    assert.match(started.structuredContent.lastError, /synthetic fake Codex failure/);

    const read = await client.callTool({
      name: "read_subagent_session",
      arguments: {
        projectRoot,
        sessionId: started.structuredContent.sessionId,
      },
    });
    assert.equal(read.structuredContent.status, "failed");
    assert.match(read.structuredContent.lastError, /synthetic fake Codex failure/);
    assert.match(read.content[0].text, /synthetic fake Codex failure/);
  } finally {
    await client.close();
  }
});

test("MCP create_agentdesk_task requires confirmation for similar tasks", async () => {
  const projectRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-confirm-")));
  await initializeGitProject(projectRoot);
  await writeReadyAgentDeskTask(projectRoot, "task-mcp-similar", "MCP duplicate guard");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-confirm-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "create_agentdesk_task",
      arguments: {
        projectRoot,
        title: "MCP duplicate guard",
        brief: "Exercise AgentDesk MCP session orchestration.",
      },
    });

    assert.equal(result.structuredContent.requiresConfirmation, true);
    assert.equal(result.structuredContent.requestedTitle, "MCP duplicate guard");
    assert.equal(result.structuredContent.requestedBrief, "Exercise AgentDesk MCP session orchestration.");
    assert.equal(result.structuredContent.similarTaskAction, "confirm");
    assert.equal(result.structuredContent.message, "Similar AgentDesk task(s) were found. Confirm whether to continue an existing task or rebuild a fresh task.");
    assert.deepEqual(result.structuredContent.confirmationChoices.map((choice) => choice.action), [
      "continue",
      "rebuild",
    ]);
    assert.equal(result.structuredContent.similarTasks[0].taskId, "task-mcp-similar");
    assert.equal(result.structuredContent.similarTasks[0].status, "ready");
    assert.equal(result.structuredContent.similarTasks[0].sessionCount, 0);
    assert.ok(result.structuredContent.similarTasks[0].similarityScore >= 0.98);
    assert.match(result.structuredContent.similarTasks[0].similarityReason, /same or near-identical/);
    assert.match(result.content[0].text, /continue an existing task or rebuild a fresh task/);
  } finally {
    await client.close();
  }
});

test("MCP list/read AgentDesk tasks returns structured task memory and session summaries", async () => {
  const projectRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-task-state-")));
  await initializeGitProject(projectRoot);
  await writeReadyAgentDeskTask(projectRoot, "task-mcp-structured", "MCP structured task output");

  const taskDir = path.join(projectRoot, ".agent-desk", "tasks", "task-mcp-structured");
  await fs.writeFile(path.join(taskDir, "memory.md"), [
    "# Task Memory",
    "",
    "Shared structured context.",
    "",
    "<!-- agentdesk-memory:session-latest:agent-01 -->",
    "## agent-01 - Summarize verification",
    "",
    "- Session: session-latest",
    "- Status: succeeded",
    "- Completed: 2026-05-15T08:05:00.000Z",
    "- Summary: Structured output verified.",
    "- Changed files: test/mcp-server.test.mjs",
    "- Tests: node --test test/mcp-server.test.mjs",
    "- Risks: none",
    "- Notes: MCP task summaries remain structured.",
    "- Error: -",
    "<!-- /agentdesk-memory:session-latest:agent-01 -->",
    "",
  ].join("\n"), "utf8");

  await writeAgentDeskSession(projectRoot, {
    taskId: "task-mcp-structured",
    sessionId: "session-older",
    status: "failed",
    updatedAt: "2026-05-15T07:30:00.000Z",
    completedAt: "2026-05-15T07:30:00.000Z",
    totalAgents: 1,
    succeededAgents: 0,
    failedAgents: 1,
    agentStatus: "failed",
    agentSummary: "Earlier attempt failed.",
    lastError: "synthetic failure",
  });
  await writeAgentDeskSession(projectRoot, {
    taskId: "task-mcp-structured",
    sessionId: "session-latest",
    status: "succeeded",
    updatedAt: "2026-05-15T08:05:00.000Z",
    completedAt: "2026-05-15T08:05:00.000Z",
    totalAgents: 1,
    succeededAgents: 1,
    failedAgents: 0,
    agentStatus: "succeeded",
    agentSummary: "Structured output verified.",
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-task-state-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.callTool({
      name: "list_agentdesk_tasks",
      arguments: { projectRoot },
    });

    assert.equal(listed.structuredContent.items.length, 1);
    const summary = listed.structuredContent.items[0];
    assert.equal(summary.taskId, "task-mcp-structured");
    assert.equal(summary.title, "MCP structured task output");
    assert.equal(summary.status, "ready");
    assert.equal(summary.sessionCount, 2);
    assert.equal(summary.latestSessionId, "session-latest");
    assert.equal(summary.latestSessionStatus, "succeeded");
    assert.equal(summary.latestSessionAt, "2026-05-15T08:05:00.000Z");

    const read = await client.callTool({
      name: "read_agentdesk_task",
      arguments: {
        projectRoot,
        taskId: "task-mcp-structured",
      },
    });

    assert.equal(read.structuredContent.taskId, "task-mcp-structured");
    assert.equal(read.structuredContent.status, "ready");
    assert.match(read.structuredContent.markdown, /Summarize verification/);
    assert.equal(read.structuredContent.memoryPath, path.join(taskDir, "memory.md"));
    assert.match(read.structuredContent.memory, /Shared structured context/);
    assert.match(read.structuredContent.memory, /Structured output verified/);
    assert.equal(read.structuredContent.sessions.length, 2);
    assert.deepEqual(read.structuredContent.sessions.map((session) => session.sessionId), [
      "session-latest",
      "session-older",
    ]);
    assert.equal(read.structuredContent.sessions[0].status, "succeeded");
    assert.equal(read.structuredContent.sessions[0].taskTitle, "MCP structured task output");
    assert.equal(read.structuredContent.sessions[0].totalAgents, 1);
    assert.equal(read.structuredContent.sessions[0].succeededAgents, 1);
    assert.equal(read.structuredContent.sessions[0].failedAgents, 0);
    assert.equal(read.structuredContent.sessions[1].status, "failed");
    assert.equal(read.structuredContent.sessions[1].lastError, "synthetic failure");
  } finally {
    await client.close();
  }
});

test("MCP server prepares Codex App subagent launch plans", async () => {
  const projectRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-app-")));
  await initializeGitProject(projectRoot);
  await writeReadyAgentDeskTask(projectRoot, "task-mcp-app", "MCP App fanout");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-app-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const started = await client.callTool({
      name: "start_subagent_session",
      arguments: {
        projectRoot,
        taskId: "task-mcp-app",
        subagentLauncher: "codex-app",
        parallelism: 5,
      },
    });

    assert.equal(started.structuredContent.status, "succeeded");
    assert.equal(started.structuredContent.executionMode, "current-branch");
    assert.equal(started.structuredContent.subagentLauncher, "codex-app");
    assert.equal(started.structuredContent.requiresHostLaunch, true);
    assert.equal(started.structuredContent.waitedForCompletion, false);
    assert.equal(started.structuredContent.succeededAgents, 0);
    const launchPlan = started.structuredContent.appLaunchPlan;
    assert.equal(launchPlan.requiresHostLaunch, true);
    assert.equal(launchPlan.launchTool, "spawn_agent");
    assert.equal(launchPlan.parallelism, 5);
    assert.equal(launchPlan.subagents.length, 3);
    assert.deepEqual(
      launchPlan.subagents.map((subagent) => subagent.status),
      ["prepared_for_app", "prepared_for_app", "prepared_for_app"],
    );
    assert.deepEqual(
      launchPlan.subagents.map((subagent) => subagent.title),
      ["Inspect API surface", "Validate session launcher", "Summarize verification"],
    );
    for (const subagent of launchPlan.subagents) {
      assert.match(subagent.taskSnapshotPath, /task\.snapshot\.md$/);
      assert.match(subagent.memorySnapshotPath, /memory\.snapshot\.md$/);
      assert.match(subagent.promptPath, /prompt\.md$/);
      assert.equal(subagent.prompt, await fs.readFile(subagent.promptPath, "utf8"));
      assert.match(subagent.prompt, /You are one AgentDesk implementation subagent running in the shared current checkout\./);
      assert.match(subagent.prompt, /No separate git worktree was created/);
      assert.match(subagent.prompt, /Subagent launcher: codex-app/);
      assert.match(subagent.prompt, new RegExp(`Assigned subtask: ${escapeRegExp(subagent.title)}`));
      assert.match(subagent.prompt, /Shared task memory snapshot:/);
      assert.match(subagent.prompt, /Existing MCP memory/);
    }

    const read = await client.callTool({
      name: "read_subagent_session",
      arguments: {
        projectRoot,
        sessionId: started.structuredContent.sessionId,
      },
    });
    assert.equal(read.structuredContent.status, "succeeded");
    assert.equal(read.structuredContent.appLaunchPlan.subagents.length, 3);
    assert.deepEqual(
      read.structuredContent.agents.map((agent) => agent.status),
      ["prepared_for_app", "prepared_for_app", "prepared_for_app"],
    );
    assert.equal(read.structuredContent.succeededAgents, 0);

    const sessionMetaPath = path.join(
      projectRoot,
      ".agent-desk",
      "sessions",
      started.structuredContent.sessionId,
      "meta.json",
    );
    const legacyMeta = JSON.parse(await fs.readFile(sessionMetaPath, "utf8"));
    assert.equal(legacyMeta.status, "succeeded");
    assert.equal(legacyMeta.succeededAgents, 0);
    assert.deepEqual(
      legacyMeta.agents.map((agent) => agent.status),
      ["prepared_for_app", "prepared_for_app", "prepared_for_app"],
    );
    legacyMeta.status = "waiting_for_app";
    legacyMeta.completedAt = null;
    for (const agent of legacyMeta.agents) {
      agent.status = "queued";
      delete agent.paths.taskSnapshotMd;
      delete agent.paths.memorySnapshotMd;
    }
    await fs.writeFile(sessionMetaPath, JSON.stringify(legacyMeta, null, 2), "utf8");

    const legacyRead = await client.callTool({
      name: "read_subagent_session",
      arguments: {
        projectRoot,
        sessionId: started.structuredContent.sessionId,
      },
    });
    assert.equal(legacyRead.structuredContent.status, "succeeded");
    assert.equal(legacyRead.structuredContent.appLaunchPlan.subagents[0].status, "prepared_for_app");
    assert.equal(legacyRead.structuredContent.appLaunchPlan.subagents[0].taskSnapshotPath, "");
    assert.equal(legacyRead.structuredContent.appLaunchPlan.subagents[0].memorySnapshotPath, "");

    const legacyList = await client.callTool({
      name: "list_subagent_sessions",
      arguments: {
        projectRoot,
        taskId: "task-mcp-app",
      },
    });
    assert.equal(legacyList.structuredContent.items.length, 1);
    assert.equal(legacyList.structuredContent.items[0].sessionId, started.structuredContent.sessionId);
    assert.equal(legacyList.structuredContent.items[0].status, "succeeded");
    assert.equal(legacyList.structuredContent.items[0].subagentLauncher, "codex-app");
    assert.equal(legacyList.structuredContent.items[0].succeededAgents, 0);
  } finally {
    await client.close();
  }
});

async function initializeGitProject(projectRoot) {
  await run("git", ["init", "-b", "master"], { cwd: projectRoot, check: true });
  await run("git", ["config", "user.name", "AgentDesk Test"], { cwd: projectRoot, check: true });
  await run("git", ["config", "user.email", "agentdesk@example.test"], { cwd: projectRoot, check: true });
  await fs.writeFile(path.join(projectRoot, "README.md"), "# Fixture\n", "utf8");
  await run("git", ["add", "README.md"], { cwd: projectRoot, check: true });
  await run("git", ["commit", "-m", "Initial fixture"], { cwd: projectRoot, check: true });
}

async function writeReadyAgentDeskTask(projectRoot, taskId, title, subtasks = [
  "Inspect API surface",
  "Validate session launcher",
  "Summarize verification",
]) {
  const taskDir = path.join(projectRoot, ".agent-desk", "tasks", taskId);
  const taskMd = path.join(taskDir, "task.md");
  const memoryMd = path.join(taskDir, "memory.md");
  const metaJson = path.join(taskDir, "meta.json");
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(taskMd, [
    `# ${title}`,
    "",
    "## Goal",
    "Exercise AgentDesk MCP session orchestration.",
    "",
    "## Subtasks",
    ...subtasks.map((subtask) => `- [ ] ${subtask}`),
    "",
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(taskDir, "brief.md"), "Exercise AgentDesk MCP session orchestration.\n", "utf8");
  await fs.writeFile(memoryMd, "# Task Memory\n\nExisting MCP memory.\n", "utf8");
  await fs.writeFile(path.join(taskDir, "stdout.log"), "", "utf8");
  await fs.writeFile(path.join(taskDir, "stderr.log"), "", "utf8");
  await fs.writeFile(metaJson, `${JSON.stringify({
    schemaVersion: 2,
    taskId,
    title,
    brief: "Exercise AgentDesk MCP session orchestration.",
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    lastError: "",
    subtaskCount: subtasks.length,
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
  }, null, 2)}\n`, "utf8");
}

async function writeAgentDeskSession(projectRoot, options) {
  const sessionDir = path.join(projectRoot, ".agent-desk", "sessions", options.sessionId);
  const agentDir = path.join(sessionDir, "agents", "agent-01");
  const createdAt = options.createdAt || "2026-05-15T07:00:00.000Z";
  const updatedAt = options.updatedAt || createdAt;
  const agentStatus = options.agentStatus || options.status;
  await fs.mkdir(agentDir, { recursive: true });
  const metaJson = path.join(sessionDir, "meta.json");
  const docMd = path.join(sessionDir, "session.md");
  const stdoutLog = path.join(sessionDir, "stdout.log");
  const stderrLog = path.join(sessionDir, "stderr.log");
  const agent = {
    id: "agent-01",
    order: 1,
    title: "Summarize verification",
    detail: "",
    status: agentStatus,
    branchName: "current-branch",
    worktreePath: projectRoot,
    baseCommit: "abc123",
    headCommit: "def456",
    mergedCommit: "",
    changedFiles: ["test/mcp-server.test.mjs"],
    testsRun: ["node --test test/mcp-server.test.mjs"],
    risks: [],
    notes: ["MCP task summaries remain structured."],
    summary: options.agentSummary || "",
    startedAt: createdAt,
    updatedAt,
    completedAt: options.completedAt || updatedAt,
    exitCode: agentStatus === "failed" ? 1 : 0,
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
    taskId: options.taskId,
    title: "MCP structured task output",
    status: options.status,
    parallelism: options.parallelism || 1,
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
    completedAt: options.completedAt || updatedAt,
    lastError: options.lastError || "",
    totalAgents: options.totalAgents ?? 1,
    succeededAgents: options.succeededAgents ?? (options.status === "succeeded" ? 1 : 0),
    failedAgents: options.failedAgents ?? (options.status === "failed" ? 1 : 0),
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
  await fs.writeFile(metaJson, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await fs.writeFile(docMd, `# Session ${options.sessionId}\n\n- Status: ${options.status}\n`);
  await fs.writeFile(stdoutLog, "", "utf8");
  await fs.writeFile(stderrLog, "", "utf8");
  await fs.writeFile(agent.paths.promptMd, "# Prompt\n");
  await fs.writeFile(agent.paths.stdoutLog, "", "utf8");
  await fs.writeFile(agent.paths.stderrLog, "", "utf8");
}

async function writeFakeCodex(filePath) {
  await fs.writeFile(filePath, `#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("codex-cli-test 0.0.0");
  process.exit(0);
}

const execIndex = args.indexOf("exec");
if (execIndex === -1) {
  console.error("unsupported fake codex command: " + args.join(" "));
  process.exit(2);
}

const execArgs = args.slice(execIndex);
const outputFile = argAfter("-o", execArgs);
const outputSchemaFile = argAfter("--output-schema", execArgs);
const prompt = await readStdin();
await appendInvocation({
  args,
  cwd: process.cwd(),
  model: argAfter("-m", execArgs),
  configs: valuesAfter("-c", execArgs),
  outputFile,
  hasOutputSchema: Boolean(outputSchemaFile),
  prompt,
});

await incrementActive();
try {
  await sleep(Number(process.env.FAKE_CODEX_DELAY_MS || 200));
  if (process.env.FAKE_CODEX_FAIL_MESSAGE) {
    throw new Error(process.env.FAKE_CODEX_FAIL_MESSAGE);
  }
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify({
    summary: "completed via fake Codex",
    tests_run: ["fake codex"],
    risks: [],
    notes: ["Prompt length " + prompt.length],
  }, null, 2) + "\\n", "utf8");
} finally {
  await decrementActive();
}

function argAfter(flag, sourceArgs = args) {
  const index = sourceArgs.indexOf(flag);
  return index === -1 ? "" : String(sourceArgs[index + 1] || "");
}

function valuesAfter(flag, sourceArgs = args) {
  const values = [];
  for (let index = 0; index < sourceArgs.length; index += 1) {
    if (sourceArgs[index] === flag) {
      values.push(String(sourceArgs[index + 1] || ""));
      index += 1;
    }
  }
  return values;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function appendInvocation(entry) {
  const logPath = process.env.FAKE_CODEX_LOG;
  if (!logPath) {
    return;
  }
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, JSON.stringify({ ...entry, at: new Date().toISOString() }) + "\\n", "utf8");
}

async function incrementActive() {
  await mutateState((state) => {
    state.active = Number(state.active || 0) + 1;
    state.maxActive = Math.max(Number(state.maxActive || 0), state.active);
    return state;
  });
}

async function decrementActive() {
  await mutateState((state) => {
    state.active = Math.max(0, Number(state.active || 0) - 1);
    return state;
  });
}

async function mutateState(mutator) {
  const statePath = process.env.FAKE_CODEX_STATE;
  if (!statePath) {
    return;
  }
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const lockPath = statePath + ".lock";
  await acquireLock(lockPath);
  try {
    const current = JSON.parse(await fs.readFile(statePath, "utf8").catch(() => "{}"));
    await fs.writeFile(statePath, JSON.stringify(mutator(current), null, 2) + "\\n", "utf8");
  } finally {
    fsSync.rmSync(lockPath, { recursive: true, force: true });
  }
}

async function acquireLock(lockPath) {
  const started = Date.now();
  while (true) {
    try {
      fsSync.mkdirSync(lockPath);
      return;
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() - started > 5000) {
        throw error;
      }
      await sleep(10);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function waitForJson(filePath, predicate, timeoutMs = 15000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = JSON.parse(await fs.readFile(filePath, "utf8"));
      const result = predicate(value);
      if (result) {
        return result;
      }
      lastError = value.lastError || null;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${filePath}: ${lastError?.message || lastError || "no matching state"}`);
}

async function readJsonLines(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
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
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      const result = { exitCode: exitCode ?? 1, signal, stdout, stderr };
      if (options.check && result.exitCode !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`));
      } else {
        resolve(result);
      }
    });
  });
}
