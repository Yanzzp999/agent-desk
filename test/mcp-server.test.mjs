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
      "claim_next_task_item",
      "claim_overall_task",
      "claim_task_items",
      "complete_task_items",
      "create_agentdesk_task",
      "create_overall_task",
      "create_task",
      "dispatch_overall_task",
      "list_agentdesk_tasks",
      "list_overall_tasks",
      "list_subagent_sessions",
      "list_tasks",
      "read_agentdesk_task",
      "read_overall_task",
      "read_subagent_session",
      "read_task",
      "start_subagent_session",
      "update_overall_task",
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
        sessionId: "session-mcp",
        note: "manual session",
      },
    });

    assert.equal(claimed.structuredContent.claimed.length, 2);
    assert.equal(claimed.structuredContent.claimedCount, 2);
    assert.equal(claimed.structuredContent.items[0].claimedBy, "mcp-agent");
    assert.equal(claimed.structuredContent.items[0].claimSessionId, "session-mcp");
    assert.match(claimed.structuredContent.markdown, /AgentDesk claim: `mcp-agent`/);
    assert.match(claimed.structuredContent.markdown, /session: `session-mcp`/);
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
    assert.equal(listedAfterClaim.structuredContent.items[0].items[0].claimSessionId, "session-mcp");
    assert.equal(listedAfterClaim.structuredContent.items[0].items[1].claimNote, "manual session");

    const read = await client.callTool({
      name: "read_task",
      arguments: {
        taskName: "mcp-task-generation",
      },
    });

    assert.equal(read.structuredContent.claimedCount, 2);
    assert.equal(read.structuredContent.items[1].claimSessionId, "session-mcp");
    assert.equal(read.structuredContent.items[1].claimNote, "manual session");
    assert.equal(read.structuredContent.markdown, claimed.structuredContent.markdown);

    const fileText = await fs.readFile(
      path.join(projectRoot, "task", "mcp-task-generation.task.md"),
      "utf8",
    );
    assert.equal(fileText, claimed.structuredContent.markdown);

    const nextTask = await client.callTool({
      name: "create_task",
      arguments: {
        title: "MCP next claim",
        tasks: ["Implement next item"],
      },
    });
    assert.equal(nextTask.structuredContent.filename, "mcp-next-claim.task.md");

    const nextClaim = await client.callTool({
      name: "claim_next_task_item",
      arguments: {
        taskName: "MCP next claim",
        assignee: "mcp-next-agent",
        sessionId: "session-next",
      },
    });
    assert.equal(nextClaim.structuredContent.hasWork, true);
    assert.equal(nextClaim.structuredContent.claimed.length, 1);
    assert.equal(nextClaim.structuredContent.claimed[0].claimSessionId, "session-next");

    const completed = await client.callTool({
      name: "complete_task_items",
      arguments: {
        taskName: "MCP next claim",
        items: [1],
        assignee: "mcp-next-agent",
        sessionId: "session-next",
      },
    });
    assert.equal(completed.structuredContent.completed[0].checked, true);
    assert.equal(completed.structuredContent.claimedCount, 0);
    assert.doesNotMatch(completed.structuredContent.markdown, /AgentDesk claim:/);

    const noWork = await client.callTool({
      name: "claim_next_task_item",
      arguments: {
        taskName: "MCP next claim",
        assignee: "mcp-next-agent-2",
        sessionId: "session-next-2",
      },
    });
    assert.equal(noWork.structuredContent.hasWork, false);
    assert.deepEqual(noWork.structuredContent.claimed, []);
  } finally {
    await client.close();
  }
});

test("MCP markdown task tools honor explicit projectRoot and taskDir", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-scope-")));
  const serverCwd = path.join(root, "server-cwd");
  const projectRoot = path.join(root, "scoped-project");
  await fs.mkdir(serverCwd, { recursive: true });
  await fs.mkdir(projectRoot, { recursive: true });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: serverCwd,
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-scope-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const first = await client.callTool({
      name: "create_task",
      arguments: {
        projectRoot,
        taskDir: "plans/current",
        title: "MCP scoped task",
        filename: "scope.md",
        tasks: ["- [x] Normalize API", "2. Read back task"],
      },
    });
    const second = await client.callTool({
      name: "create_task",
      arguments: {
        projectRoot,
        taskDir: "plans/current",
        title: "MCP scoped duplicate",
        filename: "scope.md",
        tasks: ["Keep duplicate file"],
      },
    });

    assert.equal(first.structuredContent.projectRoot, projectRoot);
    assert.equal(first.structuredContent.taskDir, path.join(projectRoot, "plans", "current"));
    assert.equal(first.structuredContent.filename, "scope.md");
    assert.equal(second.structuredContent.filename, "scope-2.md");
    assert.match(first.structuredContent.markdown, /^- \[ \] Normalize API/m);
    assert.match(first.structuredContent.markdown, /^- \[ \] Read back task/m);

    const defaultList = await client.callTool({
      name: "list_tasks",
      arguments: {
        projectRoot,
      },
    });
    assert.equal(defaultList.structuredContent.taskDir, path.join(projectRoot, "task"));
    assert.deepEqual(defaultList.structuredContent.items, []);

    const scopedList = await client.callTool({
      name: "list_tasks",
      arguments: {
        projectRoot,
        taskDir: "plans/current",
      },
    });
    assert.equal(scopedList.structuredContent.taskDir, path.join(projectRoot, "plans", "current"));
    assert.deepEqual(scopedList.structuredContent.items.map((item) => item.filename), ["scope-2.md", "scope.md"]);
    assert.deepEqual(scopedList.structuredContent.items.map((item) => item.taskCount), [1, 2]);

    const read = await client.callTool({
      name: "read_task",
      arguments: {
        projectRoot,
        taskDir: "plans/current",
        taskName: "MCP scoped task",
      },
    });
    assert.equal(read.structuredContent.filename, "scope.md");
    assert.equal(read.structuredContent.filePath, path.join(projectRoot, "plans", "current", "scope.md"));
    assert.deepEqual(read.structuredContent.items.map((item) => item.title), ["Normalize API", "Read back task"]);
    assert.equal(
      await fs.readFile(path.join(projectRoot, "plans", "current", "scope.md"), "utf8"),
      read.structuredContent.markdown,
    );

    const launchedCwdList = await client.callTool({
      name: "list_tasks",
      arguments: {},
    });
    assert.equal(launchedCwdList.structuredContent.projectRoot, serverCwd);
    assert.deepEqual(launchedCwdList.structuredContent.items, []);
  } finally {
    await client.close();
  }
});

test("MCP claim_next_task_item skips completed and claimed items in order", async () => {
  const projectRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-next-")));
  const taskDir = path.join(projectRoot, "task");
  const taskPath = path.join(taskDir, "mixed-next-claim.task.md");
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(taskPath, [
    "# Mixed next claim",
    "",
    "## Tasks",
    "",
    "- [x] Already complete",
    "- [ ] Already claimed elsewhere",
    "  - AgentDesk claim: `other-agent` at 2026-05-14T00:00:00.000Z; session: `session-other`; note: already underway",
    "- [ ] First idle item",
    "- [ ] Second idle item",
    "",
  ].join("\n"), "utf8");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-next-test", version: "0.0.0" });
  const calls = [];
  let finalMarkdown = "";

  const duplicateClaimedIndexes = () => {
    const seen = new Set();
    const duplicate = new Set();
    for (const call of calls) {
      for (const item of call.claimed) {
        if (seen.has(item.index)) {
          duplicate.add(item.index);
        }
        seen.add(item.index);
      }
    }
    return [...duplicate].sort((left, right) => left - right);
  };

  const evidence = () => JSON.stringify({
    callOrder: calls.map((call) => call.label),
    payloads: calls,
    markdown: finalMarkdown,
    duplicateClaimedIndexes: duplicateClaimedIndexes(),
  }, null, 2);

  const callNext = async (label, assignee, sessionId) => {
    const result = await client.callTool({
      name: "claim_next_task_item",
      arguments: {
        taskName: "mixed-next-claim.task.md",
        assignee,
        sessionId,
        note: label,
      },
    });
    const payload = result.structuredContent;
    calls.push({
      label,
      hasWork: payload.hasWork,
      claimedCount: payload.claimedCount,
      claimed: payload.claimed.map((item) => ({
        index: item.index,
        title: item.title,
        claimedBy: item.claimedBy,
        claimSessionId: item.claimSessionId,
      })),
      items: payload.items.map((item) => ({
        index: item.index,
        title: item.title,
        checked: item.checked,
        claimedBy: item.claimedBy,
        claimSessionId: item.claimSessionId,
      })),
    });
    return payload;
  };

  try {
    await client.connect(transport);
    const first = await callNext("first-call", "agent-alpha", "session-alpha");
    const second = await callNext("second-call", "agent-beta", "session-beta");
    const empty = await callNext("third-call", "agent-gamma", "session-gamma");
    finalMarkdown = await fs.readFile(taskPath, "utf8");

    assert.deepEqual(calls.map((call) => call.hasWork), [true, true, false], evidence());
    assert.deepEqual(calls.map((call) => call.claimed[0]?.index ?? null), [3, 4, null], evidence());
    assert.deepEqual(duplicateClaimedIndexes(), [], evidence());

    assert.equal(first.items[0].checked, true, evidence());
    assert.equal(first.items[1].claimedBy, "other-agent", evidence());
    assert.equal(first.items[1].claimSessionId, "session-other", evidence());
    assert.equal(first.claimed[0].title, "First idle item", evidence());
    assert.equal(second.claimed[0].title, "Second idle item", evidence());
    assert.deepEqual(empty.claimed, [], evidence());
    assert.equal(empty.claimedCount, 3, evidence());
    assert.equal(empty.taskCount, 4, evidence());
    assert.equal(empty.doneCount, 1, evidence());

    assert.equal((finalMarkdown.match(/AgentDesk claim:/g) || []).length, 3, evidence());
    assert.match(finalMarkdown, /AgentDesk claim: `other-agent`.+session: `session-other`/, evidence());
    assert.match(finalMarkdown, /AgentDesk claim: `agent-alpha`.+session: `session-alpha`/, evidence());
    assert.match(finalMarkdown, /AgentDesk claim: `agent-beta`.+session: `session-beta`/, evidence());
  } catch (error) {
    finalMarkdown ||= await fs.readFile(taskPath, "utf8").catch((readError) => `failed to read task file: ${readError.message}`);
    error.message = `${error.message}\nclaim_next_task_item evidence:\n${evidence()}`;
    throw error;
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
  const codexHome = path.join(root, "codex-home");
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
      CODEX_HOME: codexHome,
      FAKE_CODEX_STATE: fakeState,
      FAKE_CODEX_LOG: fakeLog,
      FAKE_CODEX_DELAY_MS: "700",
      AGENT_DESK_CODEX_SESSION_DISCOVERY_TIMEOUT_MS: "5000",
      AGENT_DESK_CODEX_REPORT_TIMEOUT_MS: "30000",
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
    assert.equal(task.structuredContent.name, "MCP CLI fanout");
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
        parallelism: 12,
      },
    });

    assert.equal(started.structuredContent.subagentLauncher, "codex-cli");
    assert.equal(started.structuredContent.name, "MCP CLI fanout");
    assert.equal(started.structuredContent.requiresHostLaunch, false);
    assert.equal(started.structuredContent.waitedForCompletion, true);
    assert.equal(started.structuredContent.parallelism, 12);
    assert.equal(started.structuredContent.batchSize, 6);
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
    assert.equal(meta.name, "MCP CLI fanout");
    assert.equal(meta.totalAgents, 7);
    assert.equal(meta.succeededAgents, 7);
    assert.equal(meta.failedAgents, 0);
    assert.equal(meta.runningAgents, 0);
    assert.equal(meta.executionMode, "current-branch");
    assert.equal(meta.subagentLauncher, "codex-cli");
    assert.equal(meta.parallelism, 12);
    assert.equal(meta.batchSize, 6);
    const launchTokens = new Set(meta.agents.map((agent) => agent.launchToken));
    assert.equal(launchTokens.size, meta.agents.length);
    assert.ok(meta.agents.every((agent) => agent.launchToken.startsWith(`agentdesk-${sessionId}-${agent.id}-`)));
    assert.ok(meta.agents.every((agent) => /^fake-session-/.test(agent.codexSessionId)));
    assert.ok(meta.agents.every((agent) => agent.codexResumeCommand === `codex resume --all ${agent.codexSessionId}`));
    assert.ok(meta.agents.every((agent) => agent.codexSessionPath.includes("rollout-")));
    assert.match(await fs.readFile(meta.agents[0].paths.taskSnapshotMd, "utf8"), /Inspect API surface/);
    assert.match(await fs.readFile(meta.agents[0].paths.memorySnapshotMd, "utf8"), /Existing MCP memory/);
    const firstPrompt = await fs.readFile(meta.agents[0].paths.promptMd, "utf8");
    assert.match(firstPrompt, /Execution model: gpt-5\.5/);
    assert.match(firstPrompt, /Execution reasoning: xhigh/);
    assert.match(firstPrompt, /Execution mode: current-branch/);
    assert.match(firstPrompt, /Subagent launcher: codex-cli/);
    assert.match(firstPrompt, /AgentDesk launch token: agentdesk-/);
    assert.match(firstPrompt, /Report JSON path:/);
    assert.match(firstPrompt, /Assigned subtask: Inspect API surface/);
    assert.match(firstPrompt, /Shared task memory snapshot:/);
    assert.match(firstPrompt, /Existing MCP memory/);
    assert.match(
      firstPrompt,
      new RegExp(`Write valid JSON to ${escapeRegExp(meta.agents[0].paths.reportJson)} with exactly these top-level fields: summary, tests_run, risks, notes\\.`),
    );
    assert.match(firstPrompt, /Use a concise string for summary and arrays of strings for tests_run, risks, and notes\./);
    assert.match(firstPrompt, /AgentDesk treats a valid report as your completion signal\./);

    const read = await client.callTool({
      name: "read_subagent_session",
      arguments: {
        projectRoot,
        sessionId,
      },
    });
    assert.equal(read.structuredContent.subagentLauncher, "codex-cli");
    assert.match(read.structuredContent.docContent, /Codex resume: codex resume --all fake-session-/);
    assert.match(read.content[0].text, /Codex resume: codex resume --all fake-session-/);
    assert.equal(read.structuredContent.agents.length, 7);
    for (const agent of read.structuredContent.agents) {
      assert.match(agent.codexSessionId, /^fake-session-/);
      assert.equal(agent.codexResumeCommand, `codex resume --all ${agent.codexSessionId}`);
      assert.match(agent.codexSessionPath, /rollout-/);
    }

    const state = JSON.parse(await fs.readFile(fakeState, "utf8"));
    assert.equal(state.maxActive <= 6, true);
    assert.equal(state.maxActive < 12, true);
    assert.equal(state.maxActive > 1, true);
    const invocations = await readJsonLines(fakeLog);
    const subagentInvocations = invocations.filter((entry) => entry.interactive);
    assert.equal(subagentInvocations.length, 7);
    const invocationsByOutput = new Map(subagentInvocations.map((entry) => [entry.outputFile, entry]));
    for (const agent of meta.agents) {
      const prompt = await fs.readFile(agent.paths.promptMd, "utf8");
      assert.equal(invocationsByOutput.get(agent.paths.reportJson)?.prompt, prompt);
    }
    for (const entry of subagentInvocations) {
      assert.equal(entry.args.includes("exec"), false);
      assert.equal(entry.args.includes("-o"), false);
      assert.equal(entry.args.includes("--output-schema"), false);
      assert.equal(entry.args.includes("--no-alt-screen"), true);
      assert.equal(entry.model, "gpt-5.5");
    assert.deepEqual(entry.configs, [
      "model_reasoning_effort=\"xhigh\"",
      "service_tier=\"priority\"",
    ]);
    }
  } finally {
    await client.close();
  }
});

test("MCP start_subagent_session returns after the configured codex-cli wait timeout", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-session-wait-")));
  const projectRoot = path.join(root, "project");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  const codexHome = path.join(root, "codex-home");
  await fs.mkdir(projectRoot, { recursive: true });
  await initializeGitProject(projectRoot);
  await writeReadyAgentDeskTask(projectRoot, "task-mcp-wait-timeout", "MCP wait timeout", ["Run slow fake Codex"]);
  await writeFakeCodex(fakeCodex);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      FAKE_CODEX_DELAY_MS: "1200",
      AGENT_DESK_CODEX_SESSION_DISCOVERY_TIMEOUT_MS: "5000",
      AGENT_DESK_CODEX_REPORT_TIMEOUT_MS: "30000",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-session-wait-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const started = await client.callTool({
      name: "start_subagent_session",
      arguments: {
        projectRoot,
        taskId: "task-mcp-wait-timeout",
        codexCli: fakeCodex,
        executionMode: "current-branch",
        subagentLauncher: "codex-cli",
        parallelism: 1,
        waitTimeoutMs: 50,
      },
    });

    assert.equal(started.structuredContent.requiresHostLaunch, false);
    assert.equal(started.structuredContent.waitRequested, true);
    assert.equal(started.structuredContent.waitedForCompletion, false);
    assert.equal(started.structuredContent.waitTimedOut, true);
    assert.equal(started.structuredContent.waitTimeoutMs, 50);
    assert.match(started.content[0].text, /still (queued|running) after 50 ms/);
    assert.notEqual(started.structuredContent.status, "succeeded");

    const sessionId = started.structuredContent.sessionId;
    const metaPath = path.join(projectRoot, ".agent-desk", "sessions", sessionId, "meta.json");
    await waitForJson(metaPath, (meta) => meta.status === "succeeded" ? meta : null, 15000);

    const read = await client.callTool({
      name: "read_subagent_session",
      arguments: {
        projectRoot,
        sessionId,
      },
    });
    assert.equal(read.structuredContent.status, "succeeded", read.structuredContent.lastError);
    assert.equal(read.structuredContent.succeededAgents, 1);
  } finally {
    await client.close();
  }
});

test("MCP server reports actionable Codex CLI session failures", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-session-fail-")));
  const projectRoot = path.join(root, "project");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  const codexHome = path.join(root, "codex-home");
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
      CODEX_HOME: codexHome,
      FAKE_CODEX_FAIL_MESSAGE: "synthetic fake Codex failure",
      AGENT_DESK_CODEX_SESSION_DISCOVERY_TIMEOUT_MS: "5000",
      AGENT_DESK_CODEX_REPORT_TIMEOUT_MS: "30000",
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

    const taskMarkdown = await fs.readFile(
      path.join(projectRoot, ".agent-desk", "tasks", "task-mcp-failure", "task.md"),
      "utf8",
    );
    assert.match(taskMarkdown, /- \[ \] Trigger fake Codex failure/);
    assert.match(taskMarkdown, /AgentDesk status: `failed`; session: `[^`]+`; agent: `agent-01`/);
    assert.doesNotMatch(taskMarkdown, /- \[x\] Trigger fake Codex failure/);

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
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-confirm-")));
  const projectRoot = path.join(root, "project");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  const fakeLog = path.join(root, "fake-log.jsonl");
  await fs.mkdir(projectRoot, { recursive: true });
  await initializeGitProject(projectRoot);
  await writeReadyAgentDeskTask(projectRoot, "task-mcp-similar", "MCP duplicate guard");
  await writeFakeCodex(fakeCodex);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    env: {
      ...process.env,
      FAKE_CODEX_LOG: fakeLog,
    },
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
    assert.equal(result.structuredContent.message, "A similar AgentDesk task already exists. Continue the existing task or create a separate replacement after confirming.");
    assert.equal(result.structuredContent.recovery.recommendedAction, "continue");
    assert.deepEqual(result.structuredContent.confirmationChoices.map((choice) => choice.action), [
      "continue",
      "rebuild",
    ]);
    assert.equal(result.structuredContent.confirmationChoices[0].title, "Continue Existing");
    assert.equal(result.structuredContent.confirmationChoices[0].recommended, true);
    assert.equal(result.structuredContent.similarTasks[0].taskId, "task-mcp-similar");
    assert.equal(result.structuredContent.similarTasks[0].status, "ready");
    assert.equal(result.structuredContent.similarTasks[0].sessionCount, 0);
    assert.ok(result.structuredContent.similarTasks[0].similarityScore >= 0.98);
    assert.match(result.structuredContent.similarTasks[0].similarityReason, /same or near-identical/);
    assert.match(result.content[0].text, /Continue Existing/);

    const continued = await client.callTool({
      name: "create_agentdesk_task",
      arguments: {
        projectRoot,
        title: "MCP duplicate guard",
        brief: "Exercise AgentDesk MCP session orchestration.",
        similarTaskAction: "continue",
      },
    });

    assert.equal(continued.structuredContent.requiresConfirmation, false);
    assert.equal(continued.structuredContent.reusedExistingTask, true);
    assert.equal(continued.structuredContent.similarTaskAction, "continue");
    assert.equal(continued.structuredContent.taskId, "task-mcp-similar");
    assert.equal(continued.structuredContent.similarTasks[0].taskId, "task-mcp-similar");
    assert.match(continued.content[0].text, /Continuing existing AgentDesk task/);

    const rebuilt = await client.callTool({
      name: "create_agentdesk_task",
      arguments: {
        projectRoot,
        title: "MCP duplicate guard",
        brief: "Exercise AgentDesk MCP session orchestration.",
        similarTaskAction: "rebuild",
        codexCli: fakeCodex,
      },
    });

    assert.equal(rebuilt.structuredContent.requiresConfirmation, false);
    assert.equal(rebuilt.structuredContent.similarTaskAction, "rebuild");
    assert.equal(rebuilt.structuredContent.similarTasks[0].taskId, "task-mcp-similar");
    assert.notEqual(rebuilt.structuredContent.taskId, "task-mcp-similar");
    assert.match(rebuilt.content[0].text, /Started AgentDesk task generation/);

    const rebuiltTaskId = rebuilt.structuredContent.taskId;
    const rebuiltMetaPath = path.join(projectRoot, ".agent-desk", "tasks", rebuiltTaskId, "meta.json");
    await waitForJson(rebuiltMetaPath, (meta) => meta.status === "ready" && meta.subtaskCount === 3);

    const listed = await client.callTool({
      name: "list_agentdesk_tasks",
      arguments: { projectRoot },
    });

    assert.equal(listed.structuredContent.items.length, 2);
    const rebuiltSummary = listed.structuredContent.items.find((item) => item.taskId === rebuiltTaskId);
    assert.equal(rebuiltSummary.name, "Generated MCP Control Plane Task");
    assert.equal(rebuiltSummary.status, "ready");
    assert.equal(rebuiltSummary.subtaskCount, 3);

    const read = await client.callTool({
      name: "read_agentdesk_task",
      arguments: {
        projectRoot,
        taskId: rebuiltTaskId,
      },
    });

    assert.equal(read.structuredContent.taskId, rebuiltTaskId);
    assert.equal(read.structuredContent.name, "Generated MCP Control Plane Task");
    assert.equal(read.structuredContent.status, "ready");
    assert.equal(read.structuredContent.subtaskCount, 3);
    assert.match(read.structuredContent.markdown, /^# Generated MCP Control Plane Task/m);
    assert.match(read.structuredContent.markdown, /## Acceptance Criteria/);
    assert.match(read.structuredContent.markdown, /- \[ \] Inspect create_agentdesk_task generation/);
    assert.match(read.structuredContent.markdown, /- \[ \] Verify list_agentdesk_tasks summary fields/);
    assert.match(read.structuredContent.markdown, /- \[ \] Read generated task.md content/);
    assert.match(read.structuredContent.memory, /# Task Memory/);
    assert.equal(
      read.structuredContent.memoryPath,
      path.join(projectRoot, ".agent-desk", "tasks", rebuiltTaskId, "memory.md"),
    );

    const invocations = await readJsonLines(fakeLog);
    const generationInvocation = invocations.find((entry) => entry.outputFile.endsWith("task.md"));
    assert.ok(generationInvocation, JSON.stringify(invocations, null, 2));
    assert.equal(generationInvocation.hasOutputSchema, false);
    assert.equal(generationInvocation.model, "gpt-5.5");
    assert.deepEqual(generationInvocation.configs, [
      "model_reasoning_effort=\"xhigh\"",
      "service_tier=\"priority\"",
    ]);
    assert.match(generationInvocation.prompt, /Write markdown only/);
    assert.match(generationInvocation.prompt, /Task title hint: MCP duplicate guard/);
    assert.match(generationInvocation.prompt, /Exercise AgentDesk MCP session orchestration/);
  } finally {
    await client.close();
  }
});

test("MCP create_agentdesk_task guides failed similar task replacement and links recovery", { timeout: 60000 }, async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-failed-confirm-")));
  const projectRoot = path.join(root, "project");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  const fakeLog = path.join(root, "fake-log.jsonl");
  await fs.mkdir(projectRoot, { recursive: true });
  await initializeGitProject(projectRoot);
  await writeFailedAgentDeskTask(projectRoot, "task-mcp-failed-similar", "MCP failed duplicate guard");
  await writeFakeCodex(fakeCodex);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    env: {
      ...process.env,
      FAKE_CODEX_LOG: fakeLog,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-failed-confirm-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "create_agentdesk_task",
      arguments: {
        projectRoot,
        title: "MCP failed duplicate guard",
        brief: "Exercise AgentDesk MCP session orchestration.",
      },
    });

    assert.equal(result.structuredContent.requiresConfirmation, true);
    assert.equal(result.structuredContent.similarTasks[0].status, "failed");
    assert.equal(result.structuredContent.recovery.state, "similar_failed_task");
    assert.equal(result.structuredContent.recovery.recommendedAction, "rebuild");
    assert.equal(result.structuredContent.confirmationChoices.find((choice) => choice.action === "rebuild")?.recommended, true);
    assert.match(result.content[0].text, /did not finish/);

    const rebuilt = await client.callTool({
      name: "create_agentdesk_task",
      arguments: {
        projectRoot,
        title: "MCP failed duplicate guard",
        brief: "Exercise AgentDesk MCP session orchestration.",
        similarTaskAction: "rebuild",
        codexCli: fakeCodex,
      },
    });

    const rebuiltTaskId = rebuilt.structuredContent.taskId;
    assert.notEqual(rebuiltTaskId, "task-mcp-failed-similar");
    assert.deepEqual(rebuilt.structuredContent.supersededTaskIds, ["task-mcp-failed-similar"]);
    assert.equal(rebuilt.structuredContent.recovery.state, "replacement_started");
    await waitForJson(path.join(projectRoot, ".agent-desk", "tasks", rebuiltTaskId, "meta.json"), (meta) => meta.status === "ready");

    const failedMeta = JSON.parse(await fs.readFile(
      path.join(projectRoot, ".agent-desk", "tasks", "task-mcp-failed-similar", "meta.json"),
      "utf8",
    ));
    assert.equal(failedMeta.supersededBy, rebuiltTaskId);
    assert.equal(failedMeta.status, "failed");

    const readFailed = await client.callTool({
      name: "read_agentdesk_task",
      arguments: {
        projectRoot,
        taskId: "task-mcp-failed-similar",
      },
    });
    assert.equal(readFailed.structuredContent.recovery.state, "superseded");
    assert.equal(readFailed.structuredContent.recovery.replacementTaskId, rebuiltTaskId);
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
    assert.equal(summary.name, "MCP structured task output");
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
    assert.equal(read.structuredContent.name, "MCP structured task output");
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
    assert.equal(read.structuredContent.sessions[0].name, "MCP structured task output");
    assert.equal(read.structuredContent.sessions[0].taskName, "MCP structured task output");
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

    assert.equal(started.structuredContent.status, "waiting_for_app");
    assert.equal(started.structuredContent.executionMode, "current-branch");
    assert.equal(started.structuredContent.subagentLauncher, "codex-app");
    assert.equal(started.structuredContent.requiresHostLaunch, true);
    assert.equal(started.structuredContent.waitedForCompletion, false);
    assert.equal(started.structuredContent.succeededAgents, 0);
    assert.match(started.content[0].text, /Prepared 3 Codex App subagent prompt/);
    assert.doesNotMatch(started.content[0].text, /Completed AgentDesk Codex CLI session/);
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
    assert.equal(read.structuredContent.status, "waiting_for_app");
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
    assert.equal(legacyMeta.status, "waiting_for_app");
    assert.equal(legacyMeta.completedAt, null);
    assert.equal(legacyMeta.succeededAgents, 0);
    assert.deepEqual(
      legacyMeta.agents.map((agent) => agent.status),
      ["prepared_for_app", "prepared_for_app", "prepared_for_app"],
    );
    const taskMeta = JSON.parse(await fs.readFile(
      path.join(projectRoot, ".agent-desk", "tasks", "task-mcp-app", "meta.json"),
      "utf8",
    ));
    assert.equal(taskMeta.status, "running");
    assert.equal(taskMeta.activeSessionId, started.structuredContent.sessionId);
    assert.equal(taskMeta.activeSessionStatus, "waiting_for_app");
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
    assert.equal(legacyRead.structuredContent.status, "waiting_for_app");
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
    assert.equal(legacyList.structuredContent.items[0].status, "waiting_for_app");
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

async function writeFailedAgentDeskTask(projectRoot, taskId, title) {
  const taskDir = path.join(projectRoot, ".agent-desk", "tasks", taskId);
  const taskMd = path.join(taskDir, "task.md");
  const memoryMd = path.join(taskDir, "memory.md");
  const metaJson = path.join(taskDir, "meta.json");
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(taskMd, "", "utf8");
  await fs.writeFile(path.join(taskDir, "brief.md"), "Exercise AgentDesk MCP session orchestration.\n", "utf8");
  await fs.writeFile(memoryMd, "# Task Memory\n\nFailed task memory.\n", "utf8");
  await fs.writeFile(path.join(taskDir, "stdout.log"), "", "utf8");
  await fs.writeFile(path.join(taskDir, "stderr.log"), "task generation failed\n", "utf8");
  await fs.writeFile(metaJson, `${JSON.stringify({
    schemaVersion: 2,
    taskId,
    title,
    brief: "Exercise AgentDesk MCP session orchestration.",
    status: "failed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    lastError: "task generation failed",
    subtaskCount: 0,
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

if (args[0] === "debug" && args[1] === "models") {
  console.log(JSON.stringify({ models: [{ slug: "gpt-5.5", default_reasoning_level: "xhigh", supported_reasoning_levels: ["low", "medium", "high", "xhigh"], additional_speed_tiers: ["fast"], service_tiers: [{ id: "priority", name: "Fast" }] }] }));
  process.exit(0);
}

const execIndex = args.indexOf("exec");
if (execIndex !== -1) {
  await runExecInvocation(args.slice(execIndex));
} else {
  await runInteractiveInvocation();
}

async function runExecInvocation(execArgs) {
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
    interactive: false,
    prompt,
  });

  await incrementActive();
  try {
    await sleep(Number(process.env.FAKE_CODEX_DELAY_MS || 200));
    if (process.env.FAKE_CODEX_FAIL_MESSAGE && outputSchemaFile) {
      throw new Error(process.env.FAKE_CODEX_FAIL_MESSAGE);
    }
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    if (outputSchemaFile) {
      await writeFakeSubagentReport(outputFile, prompt);
    } else {
      await fs.writeFile(outputFile, [
        "# Generated MCP Control Plane Task",
        "",
        "## Goal",
        "Validate AgentDesk control-plane task generation from a Codex-produced markdown document.",
        "",
        "## Context",
        "This deterministic fake Codex response exercises create/list/read task behavior without a live Codex dependency.",
        "",
        "## Acceptance Criteria",
        "- Task generation writes task.md.",
        "- list_agentdesk_tasks reports the generated task as ready.",
        "- read_agentdesk_task returns the generated markdown and task memory.",
        "",
        "## Subtasks",
        "- [ ] Inspect create_agentdesk_task generation",
        "- [ ] Verify list_agentdesk_tasks summary fields",
        "- [ ] Read generated task.md content",
        "",
      ].join("\\n"), "utf8");
    }
  } finally {
    await decrementActive();
  }
}

async function runInteractiveInvocation() {
  const prompt = String(args[args.length - 1] || "");
  const outputFile = reportPathFromPrompt(prompt);
  const launchToken = launchTokenFromPrompt(prompt);
  const agentId = agentIdFromOutput(outputFile);
  const codexSessionId = await writeFakeRollout(prompt, launchToken, agentId);
  await appendInvocation({
    args,
    cwd: process.cwd(),
    model: argAfter("-m", args),
    configs: valuesAfter("-c", args),
    outputFile,
    hasOutputSchema: false,
    interactive: true,
    codexSessionId,
    prompt,
  });

  await incrementActive();
  try {
    await sleep(Number(process.env.FAKE_CODEX_DELAY_MS || 200));
    if (process.env.FAKE_CODEX_FAIL_MESSAGE) {
      throw new Error(process.env.FAKE_CODEX_FAIL_MESSAGE);
    }
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await writeFakeSubagentReport(outputFile, prompt);
  } finally {
    await decrementActive();
  }
}

async function writeFakeSubagentReport(outputFile, prompt) {
  await fs.writeFile(outputFile, JSON.stringify({
    summary: "completed via fake Codex",
    tests_run: ["fake codex"],
    risks: [],
    notes: ["Prompt length " + prompt.length],
  }, null, 2) + "\\n", "utf8");
}

function reportPathFromPrompt(prompt) {
  const match = String(prompt || "").match(/^Report JSON path:\\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function launchTokenFromPrompt(prompt) {
  const match = String(prompt || "").match(/^AgentDesk launch token:\\s*(\\S+)$/m);
  return match ? match[1] : "";
}

function agentIdFromOutput(outputFile) {
  const parts = String(outputFile || "").split(path.sep);
  const index = parts.lastIndexOf("agents");
  return index === -1 ? "agent-unknown" : parts[index + 1] || "agent-unknown";
}

async function writeFakeRollout(prompt, launchToken, agentId) {
  const now = new Date();
  const iso = now.toISOString();
  const sessionId = "fake-session-" + agentId + "-" + process.pid + "-" + now.getTime();
  const home = process.env.CODEX_HOME || path.join(process.cwd(), ".fake-codex-home");
  const dir = path.join(
    home,
    "sessions",
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  );
  const file = path.join(dir, "rollout-" + now.getTime() + "-" + sessionId + ".jsonl");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, [
    JSON.stringify({ timestamp: iso, type: "session_meta", payload: { id: sessionId, cwd: process.cwd(), originator: "codex-tui", timestamp: iso } }),
    JSON.stringify({ timestamp: iso, type: "turn_context", payload: { cwd: process.cwd() } }),
    JSON.stringify({ timestamp: iso, type: "event_msg", payload: { type: "user_message", message: prompt, launchToken } }),
    "",
  ].join("\\n"), "utf8");
  return sessionId;
}

function argAfter(flag, sourceArgs = args) {
  const index = sourceArgs.indexOf(flag);
  return index === -1 ? "" : String(sourceArgs[index + 1] || "");
}

function valuesAfter(flag, sourceArgs = args) {
  const values = [];
  for (let index = 0; index < sourceArgs.length; index += 1) {
    if (sourceArgs[index] === flag || (flag === "-c" && sourceArgs[index] === "--config")) {
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
