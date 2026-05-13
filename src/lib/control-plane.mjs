import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CONTROL_PLANE_ROOT = path.resolve(MODULE_DIR, "../..");
const SCHEMA_VERSION = 1;
const ATTENTION_STATUSES = new Set(["failed", "stale", "stopped", "needs_attention"]);

export function findProjectRoot(cwd = process.cwd()) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return path.resolve(cwd);
}

export function createContext(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || findProjectRoot(options.cwd || process.cwd()));
  const stateRoot = path.resolve(options.stateRoot || process.env.RALPH_STATE_DIR || path.join(projectRoot, ".ralph"));
  const uiStateRoot = path.resolve(options.uiStateRoot || process.env.RALPH_UI_STATE_DIR || path.join(projectRoot, ".ralph-ui"));
  return {
    projectRoot,
    stateRoot,
    runsRoot: path.join(stateRoot, "runs"),
    currentRunFile: path.join(stateRoot, "current-run"),
    uiStateRoot,
    plansRoot: path.join(uiStateRoot, "plans"),
    controlPlaneRoot: CONTROL_PLANE_ROOT,
    ralphRunCli: resolveRalphCli(options.ralphRunCli || process.env.RALPH_RUN_CLI, projectRoot, [
      "ralph-run",
      "scripts",
      "ralph-run.sh",
    ]),
    ralphPlanCli: resolveRalphCli(options.ralphPlanCli || process.env.RALPH_PLAN_CLI, projectRoot, [
      "ralph",
      "scripts",
      "ralph.sh",
    ]),
  };
}

export function resolveRalphCli(explicitPath, projectRoot, relativeSegments) {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const candidateRoots = resolveSkillRoots(projectRoot);

  for (const root of candidateRoots) {
    const candidate = path.join(root, ...relativeSegments);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(preferredSkillRoot(candidateRoots), ...relativeSegments);
}

function resolveSkillRoots(projectRoot) {
  const configuredSkillsRoot = process.env.RALPH_SKILLS_ROOT
    ? [path.resolve(process.env.RALPH_SKILLS_ROOT)]
    : [];
  return uniquePaths([
    ...configuredSkillsRoot,
    path.join(projectRoot, "skills"),
    path.join(projectRoot, ".codex", "skills"),
    path.join(projectRoot, ".gemini", "skills"),
    path.join(projectRoot, ".claude", "skills"),
    path.join(CONTROL_PLANE_ROOT, "skills"),
    path.join(path.dirname(CONTROL_PLANE_ROOT), "skills"),
    path.join(os.homedir(), ".codex", "skills"),
    path.join(os.homedir(), ".gemini", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
  ]);
}

function preferredSkillRoot(candidateRoots) {
  const existingRoot = candidateRoots.find((root) => {
    try {
      return fs.statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
  return existingRoot || path.join(os.homedir(), ".codex", "skills");
}

function uniquePaths(paths) {
  return [...new Set(paths.map((entry) => path.resolve(entry)))];
}

export async function getHealth(context) {
  return {
    ok: true,
    projectRoot: context.projectRoot,
    stateRoot: context.stateRoot,
    uiStateRoot: context.uiStateRoot,
    ralphRunCli: context.ralphRunCli,
    ralphPlanCli: context.ralphPlanCli,
  };
}

export async function listRuns(context, options = {}) {
  const entries = await readdirSafe(context.runsRoot, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runId = entry.name;
    const runDir = path.join(context.runsRoot, runId);
    const runPath = path.join(runDir, "run.json");
    const run = await readJsonSafe(runPath);
    if (!run) {
      continue;
    }
    const tasks = await readTasksForRun(runDir, run);
    const summary = buildRunSummary(tasks);
    const stat = await statSafe(runPath);
    const item = {
      runId: String(run.runId || runId),
      project: String(run.project || ""),
      status: String(run.status || deriveRunStatus(tasks)),
      counts: summary.counts,
      totalTasks: tasks.length,
      sourcePrd: run.sourcePrd || "",
      branchName: run.branchName || "",
      maxParallel: run.maxParallel || null,
      createdAt: run.createdAt || null,
      updatedAt: run.updatedAt || stat?.mtime?.toISOString() || null,
      runDir,
    };
    if (!options.status || options.status === item.status) {
      items.push(item);
    }
  }
  items.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  return { items };
}

export async function getCurrentRun(context) {
  const runId = await readTextSafe(context.currentRunFile);
  const current = runId.trim();
  if (!current) {
    return { runId: "", item: null };
  }
  const detail = await getRunDetail(context, current).catch(() => null);
  return { runId: current, item: detail ? summarizeRunItem(detail) : null };
}

export async function getRunDetail(context, runId) {
  const runDir = path.join(context.runsRoot, runId);
  const runPath = path.join(runDir, "run.json");
  const run = await readJsonRequired(runPath);
  const tasks = await readTasksForRun(runDir, run);
  const summary = buildRunSummary(tasks);
  return {
    run,
    tasks: tasks.sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0)),
    summary,
    paths: {
      runDir,
      reportPath: path.join(runDir, "report.md"),
    },
  };
}

export async function getTaskDetail(context, runId, taskId) {
  const detail = await getRunDetail(context, runId);
  const task = detail.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`task not found in run ${runId}: ${taskId}`);
  }
  return { run: detail.run, task };
}

export async function getTaskLogs(context, runId, taskId, options = {}) {
  const { task } = await getTaskDetail(context, runId, taskId);
  const lineCount = clampPositiveInteger(options.lines, 200, 2000);
  const logPath = task.logPath || path.join(context.runsRoot, runId, "logs", `${taskId}.log`);
  return {
    path: logPath,
    lines: lineCount,
    content: await readLastLines(logPath, lineCount),
  };
}

export async function getTaskResult(context, runId, taskId) {
  const { task } = await getTaskDetail(context, runId, taskId);
  const resultPath = task.resultPath || path.join(context.runsRoot, runId, "results", `${taskId}.md`);
  return {
    path: resultPath,
    content: await readTextSafe(resultPath),
  };
}

export async function collectRun(context, runId) {
  return runRalphRun(context, ["collect", "--run", runId]);
}

export async function retryTask(context, runId, taskId, options = {}) {
  const args = ["retry", taskId, "--run", runId];
  if (options.force) {
    args.push("--force");
  }
  return runRalphRun(context, args);
}

export async function stopTask(context, runId, taskId) {
  return runRalphRun(context, ["stop", taskId, "--run", runId]);
}

export async function runRalphRun(context, args) {
  await assertExecutable(context.ralphRunCli, "ralph-run CLI");
  const result = await spawnCapture(context.ralphRunCli, args, {
    cwd: context.projectRoot,
  });
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    throw new Error(details || `ralph-run exited with code ${result.exitCode}`);
  }
  return result;
}

export async function listPlanJobs(context) {
  const entries = await readdirSafe(context.plansRoot, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const meta = await readPlanMeta(context, entry.name).catch(() => null);
    if (meta) {
      items.push(meta);
    }
  }
  items.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  return { items };
}

export async function getPlanJob(context, planJobId, options = {}) {
  const meta = await readPlanMeta(context, planJobId);
  const result = await readJsonSafe(path.join(planJobDir(context, planJobId), "result.json"));
  const includeLogs = Boolean(options.includeLogs);
  return {
    ...meta,
    result: result || null,
    stdout: includeLogs ? await readTextSafe(meta.paths.stdoutLog) : undefined,
    stderr: includeLogs ? await readTextSafe(meta.paths.stderrLog) : undefined,
  };
}

export async function getPlanLogs(context, planJobId) {
  const meta = await readPlanMeta(context, planJobId);
  return {
    stdoutLog: meta.paths.stdoutLog,
    stderrLog: meta.paths.stderrLog,
    stdout: await readTextSafe(meta.paths.stdoutLog),
    stderr: await readTextSafe(meta.paths.stderrLog),
  };
}

export async function createPlanJob(context, request = {}) {
  const mode = request.mode || (request.inputPath ? "prd_to_json" : "brief_to_json");
  if (!["brief_to_json", "prd_to_json"].includes(mode)) {
    throw new Error(`unsupported planner mode: ${mode}`);
  }
  if (mode === "brief_to_json" && !String(request.featureBrief || "").trim()) {
    throw new Error("featureBrief is required for brief_to_json planner jobs");
  }
  if (mode === "prd_to_json" && !String(request.inputPath || "").trim()) {
    throw new Error("inputPath is required for prd_to_json planner jobs");
  }

  await assertExecutable(context.ralphPlanCli, "ralph planner CLI");
  await fsp.mkdir(context.plansRoot, { recursive: true });

  const now = new Date().toISOString();
  const planJobId = await uniquePlanJobId(context, request);
  const jobDir = planJobDir(context, planJobId);
  await fsp.mkdir(jobDir, { recursive: true });

  const normalizedInput = {
    mode,
    featureBrief: mode === "brief_to_json" ? String(request.featureBrief || "") : "",
    inputPath: mode === "prd_to_json" ? resolveProjectPath(context.projectRoot, request.inputPath) : "",
    outputDir: resolveProjectPath(context.projectRoot, request.outputDir || path.join(context.projectRoot, "tasks")),
    ralphDir: resolveProjectPath(context.projectRoot, request.ralphDir || context.projectRoot),
    model: request.model || "",
    reasoning: request.reasoning || "",
  };
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    planJobId,
    status: "received",
    stage: "received",
    input: normalizedInput,
    pid: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    paths: {
      jobDir,
      stdoutLog: path.join(jobDir, "stdout.log"),
      stderrLog: path.join(jobDir, "stderr.log"),
      resultJson: path.join(jobDir, "result.json"),
    },
  };
  await writeJsonAtomic(path.join(jobDir, "meta.json"), meta);
  await fsp.writeFile(meta.paths.stdoutLog, "", "utf8");
  await fsp.writeFile(meta.paths.stderrLog, "", "utf8");

  const workerPath = path.join(CONTROL_PLANE_ROOT, "src", "worker", "run-plan-job.mjs");
  const child = spawn(process.execPath, [
    workerPath,
    "--project",
    context.projectRoot,
    "--state-dir",
    context.stateRoot,
    "--ui-state-dir",
    context.uiStateRoot,
    "--job",
    planJobId,
  ], {
    cwd: context.projectRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  meta.pid = child.pid;
  meta.updatedAt = new Date().toISOString();
  await writeJsonAtomic(path.join(jobDir, "meta.json"), meta);
  return meta;
}

export async function runPlanJob(context, planJobId) {
  const metaPath = path.join(planJobDir(context, planJobId), "meta.json");
  let meta = await readJsonRequired(metaPath);
  const initialStage = meta.input.mode === "brief_to_json" ? "generating_prd" : "converting_json";
  meta = await updatePlanMeta(context, planJobId, {
    status: "running",
    stage: initialStage,
    startedAt: new Date().toISOString(),
  });

  const args = buildPlannerArgs(meta.input);
  const child = spawn(context.ralphPlanCli, args, {
    cwd: context.projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  await updatePlanMeta(context, planJobId, { pid: child.pid });

  if (meta.input.mode === "brief_to_json") {
    child.stdin.end(`${meta.input.featureBrief}\n`);
  } else {
    child.stdin.end();
  }

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    fs.appendFileSync(meta.paths.stdoutLog, text, "utf8");
    const contract = extractContract(stdout);
    if (contract.PRD_FILE && meta.input.mode === "brief_to_json") {
      updatePlanMetaSync(context, planJobId, { stage: "converting_json" });
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    fs.appendFileSync(meta.paths.stderrLog, text, "utf8");
  });

  const result = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ exitCode: 1, signal: null, error: error.message }));
    child.on("close", (exitCode, signal) => resolve({ exitCode: exitCode ?? 1, signal, error: "" }));
  });

  const contract = extractContract(stdout);
  const final = {
    planJobId,
    exitCode: result.exitCode,
    signal: result.signal,
    error: result.error,
    contract,
    completedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(meta.paths.resultJson, final);
  await updatePlanMeta(context, planJobId, {
    status: result.exitCode === 0 ? "succeeded" : "failed",
    stage: result.exitCode === 0 ? "succeeded" : "failed",
    completedAt: final.completedAt,
    lastError: result.exitCode === 0 ? "" : (result.error || stderr.trim().split(/\r?\n/).slice(-5).join("\n")),
  });
  return final;
}

export async function listArtifacts(context) {
  const artifacts = [];
  const runs = await listRuns(context);
  for (const runItem of runs.items) {
    const detail = await getRunDetail(context, runItem.runId).catch(() => null);
    if (!detail) {
      continue;
    }
    await addArtifactIfExists(artifacts, {
      kind: "run-report",
      title: `${runItem.runId} report`,
      path: detail.paths.reportPath,
      runId: runItem.runId,
    });
    for (const task of detail.tasks) {
      if (task.resultPath) {
        await addArtifactIfExists(artifacts, {
          kind: "task-result",
          title: `${task.id} result`,
          path: task.resultPath,
          runId: runItem.runId,
          taskId: task.id,
        });
      }
    }
  }

  const plans = await listPlanJobs(context);
  for (const plan of plans.items) {
    const result = await readJsonSafe(plan.paths.resultJson);
    if (!result?.contract) {
      continue;
    }
    await addArtifactIfExists(artifacts, {
      kind: "planner-prd",
      title: `${plan.planJobId} PRD`,
      path: result.contract.PRD_FILE,
      planJobId: plan.planJobId,
    });
    await addArtifactIfExists(artifacts, {
      kind: "planner-json",
      title: `${plan.planJobId} prd.json`,
      path: result.contract.PRD_JSON,
      planJobId: plan.planJobId,
    });
    await addArtifactIfExists(artifacts, {
      kind: "planner-progress",
      title: `${plan.planJobId} progress`,
      path: result.contract.PROGRESS_FILE,
      planJobId: plan.planJobId,
    });
  }

  artifacts.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  return { items: artifacts };
}

export async function readArtifact(context, artifactPath) {
  const resolved = path.resolve(String(artifactPath || ""));
  const allowedRoots = [context.projectRoot, context.stateRoot, context.uiStateRoot].map((root) => path.resolve(root));
  if (!allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    throw new Error("artifact path is outside the current Ralph project");
  }
  return {
    path: resolved,
    content: await readTextSafe(resolved),
  };
}

export async function snapshotStateStamp(context) {
  const roots = [context.stateRoot, context.uiStateRoot];
  let newest = 0;
  for (const root of roots) {
    newest = Math.max(newest, await newestMtime(root));
  }
  return String(newest);
}

function summarizeRunItem(detail) {
  return {
    runId: detail.run.runId,
    project: detail.run.project || "",
    status: detail.run.status || deriveRunStatus(detail.tasks),
    counts: detail.summary.counts,
    totalTasks: detail.tasks.length,
    updatedAt: detail.run.updatedAt || null,
    runDir: detail.paths.runDir,
  };
}

async function readTasksForRun(runDir, run) {
  const tasksDir = path.join(runDir, "tasks");
  const taskIds = Array.isArray(run.taskIds) ? run.taskIds.map(String) : [];
  if (taskIds.length > 0) {
    const tasks = [];
    for (const taskId of taskIds) {
      const task = await readJsonSafe(path.join(tasksDir, `${taskId}.json`));
      if (task) {
        tasks.push(task);
      }
    }
    return tasks;
  }
  const entries = await readdirSafe(tasksDir, { withFileTypes: true });
  const tasks = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const task = await readJsonSafe(path.join(tasksDir, entry.name));
      if (task) {
        tasks.push(task);
      }
    }
  }
  return tasks;
}

function buildRunSummary(tasks) {
  const counts = {};
  for (const task of tasks) {
    const status = String(task.status || "unknown");
    counts[status] = (counts[status] || 0) + 1;
  }
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const blockedTasks = tasks.filter((task) => {
    if (task.status !== "queued" || !Array.isArray(task.dependencies) || task.dependencies.length === 0) {
      return false;
    }
    return task.dependencies.some((dependencyId) => byId.get(dependencyId)?.status !== "succeeded");
  });
  return {
    counts,
    blockedTasks: blockedTasks.map(compactTask),
    runningTasks: tasks.filter((task) => ["running", "launching"].includes(task.status)).map(compactTask),
    failedTasks: tasks.filter((task) => ATTENTION_STATUSES.has(task.status)).map(compactTask),
  };
}

function deriveRunStatus(tasks) {
  if (tasks.length === 0) {
    return "empty";
  }
  if (tasks.every((task) => task.status === "succeeded")) {
    return "succeeded";
  }
  if (tasks.some((task) => ["running", "launching"].includes(task.status))) {
    return "running";
  }
  if (tasks.some((task) => ATTENTION_STATUSES.has(task.status))) {
    return "needs_attention";
  }
  return "queued";
}

function compactTask(task) {
  return {
    id: task.id,
    title: task.title || task.id,
    status: task.status || "unknown",
    priority: task.priority || null,
    lastError: task.lastError || "",
  };
}

function buildPlannerArgs(input) {
  const args = ["--output-mode", "json", "--ralph-dir", input.ralphDir];
  if (input.model) {
    args.push("--model", input.model);
  }
  if (input.reasoning) {
    args.push("--reasoning", input.reasoning);
  }
  if (input.mode === "prd_to_json") {
    args.push("--input", input.inputPath);
  } else {
    args.push("--output-dir", input.outputDir);
  }
  return args;
}

function extractContract(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+):\s*(.+?)\s*$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

async function uniquePlanJobId(context, request) {
  const base = `plan-${compactTimestamp(new Date())}-${slug(request.name || request.mode || "job")}`;
  let candidate = base;
  let suffix = 2;
  while (fs.existsSync(planJobDir(context, candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function slug(value) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || "job";
}

function planJobDir(context, planJobId) {
  return path.join(context.plansRoot, planJobId);
}

async function readPlanMeta(context, planJobId) {
  return readJsonRequired(path.join(planJobDir(context, planJobId), "meta.json"));
}

async function updatePlanMeta(context, planJobId, patch) {
  const metaPath = path.join(planJobDir(context, planJobId), "meta.json");
  const meta = await readJsonRequired(metaPath);
  const updated = { ...meta, ...patch, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(metaPath, updated);
  return updated;
}

function updatePlanMetaSync(context, planJobId, patch) {
  const metaPath = path.join(planJobDir(context, planJobId), "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const updated = { ...meta, ...patch, updatedAt: new Date().toISOString() };
  writeJsonAtomicSync(metaPath, updated);
  return updated;
}

async function addArtifactIfExists(artifacts, item) {
  if (!item.path) {
    return;
  }
  const stat = await statSafe(item.path);
  if (!stat?.isFile()) {
    return;
  }
  artifacts.push({
    id: `${item.kind}:${item.path}`,
    ...item,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  });
}

async function spawnCapture(command, args, options = {}) {
  return new Promise((resolve) => {
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
    child.on("error", (error) => {
      resolve({ exitCode: 1, signal: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode: exitCode ?? 1, signal, stdout, stderr });
    });
  });
}

async function assertExecutable(filePath, label) {
  try {
    await fsp.access(filePath, fs.constants.X_OK);
  } catch {
    throw new Error(`${label} is not executable: ${filePath}`);
  }
}

async function readJsonRequired(filePath) {
  const content = await fsp.readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function readJsonSafe(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tmpPath, filePath);
}

function writeJsonAtomicSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

async function readdirSafe(dirPath, options) {
  try {
    return await fsp.readdir(dirPath, options);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function statSafe(filePath) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}

async function readTextSafe(filePath) {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readLastLines(filePath, lineCount) {
  const content = await readTextSafe(filePath);
  if (!content) {
    return "";
  }
  const lines = content.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - lineCount - 1)).join("\n");
}

function clampPositiveInteger(value, fallback, max) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(number), max);
}

function resolveProjectPath(projectRoot, value) {
  if (!value) {
    return "";
  }
  return path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(projectRoot, String(value));
}

async function newestMtime(root) {
  const stat = await statSafe(root);
  if (!stat) {
    return 0;
  }
  let newest = stat.mtimeMs;
  const entries = await readdirSafe(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestMtime(fullPath));
    } else {
      const childStat = await statSafe(fullPath);
      newest = Math.max(newest, childStat?.mtimeMs || 0);
    }
  }
  return newest;
}

export function formatTable(rows, columns) {
  if (rows.length === 0) {
    return "";
  }
  const widths = columns.map((column) => {
    const values = [column.header, ...rows.map((row) => String(column.value(row) ?? ""))];
    return Math.min(column.maxWidth || 40, Math.max(...values.map((value) => value.length)));
  });
  const render = (values) => values.map((value, index) => pad(String(value ?? ""), widths[index])).join("  ").trimEnd();
  return [
    render(columns.map((column) => column.header)),
    render(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => render(columns.map((column) => truncateOneLine(column.value(row), widths[columns.indexOf(column)])))),
  ].join(os.EOL);
}

function pad(value, width) {
  return value.length >= width ? value.slice(0, width) : `${value}${" ".repeat(width - value.length)}`;
}

function truncateOneLine(value, width) {
  const text = String(value ?? "").replace(/\s+/g, " ");
  return text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text;
}
