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

test("MCP server creates task markdown in the launched project", async () => {
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

    const read = await client.callTool({
      name: "read_task",
      arguments: {
        taskName: "mcp-task-generation",
      },
    });

    assert.equal(read.structuredContent.claimedCount, 2);
    assert.equal(read.structuredContent.items[1].claimNote, "manual session");

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
  await writeReadyAgentDeskTask(projectRoot, "task-mcp-cli", "MCP CLI fanout");
  await writeFakeCodex(fakeCodex);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    env: {
      ...process.env,
      FAKE_CODEX_STATE: fakeState,
      FAKE_CODEX_LOG: fakeLog,
      FAKE_CODEX_DELAY_MS: "200",
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
        parallelism: 2,
      },
    });

    assert.equal(started.structuredContent.subagentLauncher, "codex-cli");
    assert.equal(started.structuredContent.requiresHostLaunch, false);
    assert.equal(started.structuredContent.waitedForCompletion, true);
    assert.equal(started.structuredContent.parallelism, 2);
    assert.equal(started.structuredContent.status, "succeeded", started.structuredContent.lastError);
    assert.equal(started.structuredContent.totalAgents, 3);
    assert.equal(started.structuredContent.succeededAgents, 3);
    assert.equal(started.structuredContent.executionMode, "current-branch");

    const sessionId = started.structuredContent.sessionId;
    const meta = JSON.parse(await fs.readFile(
      path.join(projectRoot, ".agent-desk", "sessions", sessionId, "meta.json"),
      "utf8",
    ));
    assert.equal(meta.status, "succeeded", meta.lastError);
    assert.equal(meta.totalAgents, 3);
    assert.equal(meta.succeededAgents, 3);
    assert.equal(meta.executionMode, "current-branch");
    assert.equal(meta.subagentLauncher, "codex-cli");
    assert.match(await fs.readFile(meta.agents[0].paths.taskSnapshotMd, "utf8"), /Inspect API surface/);
    assert.match(await fs.readFile(meta.agents[0].paths.memorySnapshotMd, "utf8"), /Existing MCP memory/);
    const firstPrompt = await fs.readFile(meta.agents[0].paths.promptMd, "utf8");
    assert.match(firstPrompt, /Shared task memory snapshot:/);
    assert.match(firstPrompt, /Existing MCP memory/);

    const state = JSON.parse(await fs.readFile(fakeState, "utf8"));
    assert.equal(state.maxActive, 2);
    const invocations = await readJsonLines(fakeLog);
    assert.equal(invocations.filter((entry) => entry.hasOutputSchema).length, 3);
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
    assert.equal(result.structuredContent.similarTasks[0].taskId, "task-mcp-similar");
    assert.match(result.content[0].text, /continue an existing task or rebuild a fresh task/);
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
    assert.equal(started.structuredContent.appLaunchPlan.launchTool, "spawn_agent");
    assert.equal(started.structuredContent.appLaunchPlan.parallelism, 5);
    assert.equal(started.structuredContent.appLaunchPlan.subagents.length, 3);
    assert.match(started.structuredContent.appLaunchPlan.subagents[0].taskSnapshotPath, /task\.snapshot\.md$/);
    assert.match(started.structuredContent.appLaunchPlan.subagents[0].memorySnapshotPath, /memory\.snapshot\.md$/);
    assert.match(started.structuredContent.appLaunchPlan.subagents[0].prompt, /Subagent launcher: codex-app/);
    assert.match(started.structuredContent.appLaunchPlan.subagents[0].prompt, /Assigned subtask: Inspect API surface/);
    assert.match(started.structuredContent.appLaunchPlan.subagents[0].prompt, /Shared task memory snapshot:/);
    assert.match(started.structuredContent.appLaunchPlan.subagents[0].prompt, /Existing MCP memory/);

    const read = await client.callTool({
      name: "read_subagent_session",
      arguments: {
        projectRoot,
        sessionId: started.structuredContent.sessionId,
      },
    });
    assert.equal(read.structuredContent.status, "waiting_for_app");
    assert.equal(read.structuredContent.appLaunchPlan.subagents.length, 3);
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

async function writeReadyAgentDeskTask(projectRoot, taskId, title) {
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
    "- [ ] Inspect API surface",
    "- [ ] Validate session launcher",
    "- [ ] Summarize verification",
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
    subtaskCount: 3,
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
  outputFile,
  hasOutputSchema: Boolean(outputSchemaFile),
  prompt,
});

await incrementActive();
try {
  await sleep(Number(process.env.FAKE_CODEX_DELAY_MS || 200));
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
