import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");
const VERUNECTL = path.join(REPO_ROOT, "bin", "verunectl.mjs");

test("verunectl help exposes CLI-only task and session commands", async () => {
  const result = await run(process.execPath, [VERUNECTL, "help"], { cwd: REPO_ROOT });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /verunectl tasks create/);
  assert.match(result.stdout, /verunectl sessions start/);
  assert.match(result.stdout, /--model MODEL/);
  assert.match(result.stdout, /--reasoning EFFORT/);
  assert.match(result.stdout, /--parallel N/);
  assert.doesNotMatch(result.stdout, /\bgui\b/i);
  assert.doesNotMatch(result.stdout, /\bserve\b/i);
  assert.doesNotMatch(result.stdout, /electron/i);
});

test("verunectl creates a task and runs configured Codex CLI subagents", { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-cli-e2e-"));
  const projectRoot = path.join(root, "project");
  const worktreesRoot = path.join(root, "worktrees");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  const fakeState = path.join(root, "fake-state.json");
  const fakeLog = path.join(root, "fake-log.jsonl");

  await fs.mkdir(projectRoot, { recursive: true });
  await writeFakeCodex(fakeCodex);
  await initializeGitProject(projectRoot);

  const env = {
    ...process.env,
    CODEX_CLI: fakeCodex,
    FAKE_CODEX_STATE: fakeState,
    FAKE_CODEX_LOG: fakeLog,
    FAKE_CODEX_DELAY_MS: "2500",
  };

  const taskCreate = await run(process.execPath, [
    VERUNECTL,
    "tasks",
    "create",
    "--project",
    projectRoot,
    "--worktrees-root",
    worktreesRoot,
    "--title",
    "CLI configured orchestration",
    "--brief",
    "Generate a task and fan it out through Codex CLI subagents.",
    "--json",
  ], { cwd: REPO_ROOT, env });
  assert.equal(taskCreate.exitCode, 0, taskCreate.stderr);
  const taskSummary = JSON.parse(taskCreate.stdout);
  const taskMeta = await waitForJson(
    path.join(projectRoot, ".agent-desk", "tasks", taskSummary.taskId, "meta.json"),
    (meta) => meta.status === "ready" ? meta : null,
  );
  assert.equal(taskMeta.subtaskCount, 3);
  assert.equal(taskMeta.paths.memoryMd, path.join(projectRoot, ".agent-desk", "tasks", taskSummary.taskId, "memory.md"));
  assert.match(await fs.readFile(taskMeta.paths.taskMd, "utf8"), /- \[ \] Implement CLI config plumbing/);
  assert.match(await fs.readFile(taskMeta.paths.memoryMd, "utf8"), /# Task Memory/);

  const sessionStart = await run(process.execPath, [
    VERUNECTL,
    "sessions",
    "start",
    taskSummary.taskId,
    "--project",
    projectRoot,
    "--worktrees-root",
    worktreesRoot,
    "--model",
    "gpt-5.5",
    "--reasoning",
    "high",
    "--parallel",
    "2",
    "--json",
  ], { cwd: REPO_ROOT, env });
  assert.equal(sessionStart.exitCode, 0, sessionStart.stderr);
  const sessionSummary = JSON.parse(sessionStart.stdout);
  const sessionMeta = await waitForJson(
    path.join(projectRoot, ".agent-desk", "sessions", sessionSummary.sessionId, "meta.json"),
    (meta) => ["succeeded", "failed"].includes(meta.status) ? meta : null,
    45000,
  );

  assert.equal(sessionMeta.status, "succeeded", sessionMeta.lastError);
  assert.equal(sessionMeta.model, "gpt-5.5");
  assert.equal(sessionMeta.reasoning, "high");
  assert.equal(sessionMeta.serviceTier, "fast");
  assert.equal(sessionMeta.parallelism, 2);
  assert.equal(sessionMeta.batchSize, 6);
  assert.equal(sessionMeta.totalAgents, 3);
  assert.equal(sessionMeta.succeededAgents, 3);
  assert.equal(sessionMeta.failedAgents, 0);
  assert.deepEqual(sessionMeta.agents.map((agent) => agent.status), ["succeeded", "succeeded", "succeeded"]);

  const sessionDoc = await fs.readFile(sessionMeta.paths.docMd, "utf8");
  assert.match(sessionDoc, /- Model: gpt-5\.5/);
  assert.match(sessionDoc, /- Reasoning: high/);
  assert.match(sessionDoc, /- Service tier: fast/);
  assert.match(sessionDoc, /- Parallelism: 2/);

  for (const agent of sessionMeta.agents) {
    const prompt = await fs.readFile(agent.paths.promptMd, "utf8");
    assert.match(prompt, /Execution model: gpt-5\.5/);
    assert.match(prompt, /Execution reasoning: high/);
    assert.match(prompt, new RegExp(`Assigned subtask: ${escapeRegExp(agent.title)}`));
    assert.match(prompt, /Shared task memory:/);
    assert.match(prompt, /# Task Memory/);
    assert.deepEqual(agent.testsRun, ["fake codex"]);
  }

  const taskMemory = await fs.readFile(taskMeta.paths.memoryMd, "utf8");
  assert.match(taskMemory, /agent-01 completed via fake Codex/);
  assert.match(taskMemory, /Tests: fake codex/);
  assert.match(taskMemory, /Notes: Prompt length/);

  const invocations = await readJsonLines(fakeLog);
  const subagentInvocations = invocations.filter((entry) => entry.hasOutputSchema);
  assert.equal(subagentInvocations.length, 3);
  for (const entry of subagentInvocations) {
    assert.equal(entry.model, "gpt-5.5");
    assert.deepEqual(entry.configs, [
      "model_reasoning_effort=\"high\"",
      "service_tier=\"fast\"",
    ]);
  }

  const state = JSON.parse(await fs.readFile(fakeState, "utf8"));
  assert.equal(state.maxActive, 2);
});

test("verunectl allocates unique task and session ids under concurrent starts", { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-cli-race-"));
  const projectRoot = path.join(root, "project");
  const worktreesRoot = path.join(root, "worktrees");
  const fakeCodex = path.join(root, "fake-codex.mjs");

  await fs.mkdir(projectRoot, { recursive: true });
  await writeFakeCodex(fakeCodex);
  await initializeGitProject(projectRoot);

  const env = {
    ...process.env,
    CODEX_CLI: fakeCodex,
    FAKE_CODEX_DELAY_MS: "300",
  };

  const taskCreates = await Promise.all([
    run(process.execPath, [
      VERUNECTL,
      "tasks",
      "create",
      "--project",
      projectRoot,
      "--worktrees-root",
      worktreesRoot,
      "--title",
      "Concurrent task collision",
      "--brief",
      "Generate one concurrent task.",
      "--rebuild",
      "--json",
    ], { cwd: REPO_ROOT, env }),
    run(process.execPath, [
      VERUNECTL,
      "tasks",
      "create",
      "--project",
      projectRoot,
      "--worktrees-root",
      worktreesRoot,
      "--title",
      "Concurrent task collision",
      "--brief",
      "Generate another concurrent task.",
      "--rebuild",
      "--json",
    ], { cwd: REPO_ROOT, env }),
  ]);
  for (const result of taskCreates) {
    assert.equal(result.exitCode, 0, result.stderr);
  }
  const taskIds = taskCreates.map((result) => JSON.parse(result.stdout).taskId);
  assert.equal(new Set(taskIds).size, 2);
  assert.deepEqual(
    (await fs.readdir(path.join(projectRoot, ".agent-desk", "tasks"))).sort(),
    taskIds.toSorted(),
  );
  await Promise.all(taskIds.map((taskId) => waitForJson(
    path.join(projectRoot, ".agent-desk", "tasks", taskId, "meta.json"),
    (meta) => meta.status === "ready" ? meta : null,
  )));

  const baseTaskCreate = await run(process.execPath, [
    VERUNECTL,
    "tasks",
    "create",
    "--project",
    projectRoot,
    "--worktrees-root",
    worktreesRoot,
    "--title",
    "Concurrent session collision",
    "--brief",
    "Generate a task for concurrent session starts.",
    "--json",
  ], { cwd: REPO_ROOT, env });
  assert.equal(baseTaskCreate.exitCode, 0, baseTaskCreate.stderr);
  const baseTaskId = JSON.parse(baseTaskCreate.stdout).taskId;
  await waitForJson(
    path.join(projectRoot, ".agent-desk", "tasks", baseTaskId, "meta.json"),
    (meta) => meta.status === "ready" ? meta : null,
  );

  const sessionStarts = await Promise.all([
    run(process.execPath, [
      VERUNECTL,
      "sessions",
      "start",
      baseTaskId,
      "--project",
      projectRoot,
      "--worktrees-root",
      worktreesRoot,
      "--execution-mode",
      "current-branch",
      "--subagent-launcher",
      "codex-cli",
      "--parallel",
      "3",
      "--json",
    ], { cwd: REPO_ROOT, env }),
    run(process.execPath, [
      VERUNECTL,
      "sessions",
      "start",
      baseTaskId,
      "--project",
      projectRoot,
      "--worktrees-root",
      worktreesRoot,
      "--execution-mode",
      "current-branch",
      "--subagent-launcher",
      "codex-cli",
      "--parallel",
      "3",
      "--json",
    ], { cwd: REPO_ROOT, env }),
  ]);
  for (const result of sessionStarts) {
    assert.equal(result.exitCode, 0, result.stderr);
  }
  const sessionIds = sessionStarts.map((result) => JSON.parse(result.stdout).sessionId);
  assert.equal(new Set(sessionIds).size, 2);
  assert.deepEqual(
    (await fs.readdir(path.join(projectRoot, ".agent-desk", "sessions"))).sort(),
    sessionIds.toSorted(),
  );

  const sessions = await Promise.all(sessionIds.map((sessionId) => waitForJson(
    path.join(projectRoot, ".agent-desk", "sessions", sessionId, "meta.json"),
    (meta) => ["succeeded", "failed"].includes(meta.status) ? meta : null,
  )));
  for (const session of sessions) {
    assert.equal(session.status, "succeeded", session.lastError);
    assert.equal(session.executionMode, "current-branch");
    assert.equal(session.succeededAgents, 3);
    assert.equal(session.failedAgents, 0);
  }
});

async function initializeGitProject(projectRoot) {
  await run("git", ["init", "-b", "master"], { cwd: projectRoot, check: true });
  await run("git", ["config", "user.name", "AgentDesk Test"], { cwd: projectRoot, check: true });
  await run("git", ["config", "user.email", "agentdesk@example.test"], { cwd: projectRoot, check: true });
  await fs.writeFile(path.join(projectRoot, "README.md"), "# Fixture\n");
  await run("git", ["add", "README.md"], { cwd: projectRoot, check: true });
  await run("git", ["commit", "-m", "Initial fixture"], { cwd: projectRoot, check: true });
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
  console.log(JSON.stringify({ models: [{ slug: "gpt-5.5", default_reasoning_level: "xhigh", supported_reasoning_levels: ["low", "medium", "high", "xhigh"], additional_speed_tiers: ["fast"] }] }));
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
});

await incrementActive();
try {
  await sleep(Number(process.env.FAKE_CODEX_DELAY_MS || 0));
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  if (outputSchemaFile) {
    const agentId = agentIdFromOutput(outputFile);
    await fs.writeFile(path.join(process.cwd(), agentId + ".txt"), "completed " + agentId + "\\n", "utf8");
    await fs.writeFile(outputFile, JSON.stringify({
      summary: agentId + " completed via fake Codex",
      tests_run: ["fake codex"],
      risks: [],
      notes: ["Prompt length " + prompt.length],
    }, null, 2) + "\\n", "utf8");
  } else {
    await fs.writeFile(outputFile, [
      "# CLI configured orchestration",
      "",
      "## Goal",
      "Prove AgentDesk runs as a CLI-only Codex orchestrator.",
      "",
      "## Context",
      "Generated by fake Codex for deterministic tests.",
      "",
      "## Acceptance Criteria",
      "- Configured model, reasoning, and concurrency are honored.",
      "",
      "## Subtasks",
      "- [ ] Implement CLI config plumbing",
      "- [ ] Persist session config",
      "- [ ] Verify concurrent Codex CLI cap",
      "",
    ].join("\\n"), "utf8");
  }
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

function agentIdFromOutput(outputFile) {
  const parts = outputFile.split(path.sep);
  const index = parts.lastIndexOf("agents");
  return index === -1 ? "agent-unknown" : parts[index + 1] || "agent-unknown";
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
      cwd: options.cwd || REPO_ROOT,
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
