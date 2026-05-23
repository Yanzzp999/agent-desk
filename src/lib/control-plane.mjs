import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CODEX_REASONING_EFFORT_OPTIONS,
  discoverCodexModels,
  resolveCodexCliPath,
} from "./codex-cli.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CONTROL_PLANE_ROOT = path.resolve(MODULE_DIR, "../..");
export const AGENT_DESK_STATE_DIRNAME = ".agent-desk";
export const DEFAULT_SUBAGENT_MODEL = "gpt-5.5";
export const DEFAULT_SUBAGENT_REASONING = "xhigh";
export const DEFAULT_SERVICE_TIER = "fast";
export const DEFAULT_PARALLELISM = 6;
export const DEFAULT_LAUNCH_BATCH_SIZE = 6;
export const MAX_PARALLELISM = 24;
export const DEFAULT_EXECUTION_MODE = "auto";
export const DEFAULT_WORKTREE_SUBAGENT_LAUNCHER = "codex-cli";
export const CONCRETE_EXECUTION_MODES = Object.freeze(["worktree", "current-branch"]);
export const EXECUTION_MODES = Object.freeze([DEFAULT_EXECUTION_MODE, ...CONCRETE_EXECUTION_MODES]);
export const CURRENT_BRANCH_SUBAGENT_LAUNCHERS = Object.freeze(["codex-cli", "codex-app"]);
export const DEFAULT_CONFIG_FILENAME = "config.toml";
export const DEFAULT_TASK_MEMORY_FILENAME = "memory.md";
export const AGENT_TASK_SNAPSHOT_FILENAME = "task.snapshot.md";
export const AGENT_MEMORY_SNAPSHOT_FILENAME = "memory.snapshot.md";
const SCHEMA_VERSION = 2;
const TASK_STATUSES = new Set(["received", "generating", "ready", "running", "succeeded", "failed"]);
const SESSION_STATUSES = new Set(["queued", "waiting_for_app", "running", "succeeded", "failed"]);
const AGENT_STATUSES = new Set(["queued", "prepared_for_app", "running", "integrating", "succeeded", "failed"]);
const SIMILAR_TASK_ACTIONS = new Set(["confirm", "continue", "rebuild"]);
const SIMILAR_TASK_SCORE_THRESHOLD = 0.72;
const BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const BOOLEAN_FALSE_VALUES = new Set(["0", "false", "no", "off"]);
const SUPPORTED_REASONING_EFFORTS = new Set(
  CODEX_REASONING_EFFORT_OPTIONS.map((option) => option.value).filter(Boolean),
);
const SUBAGENT_REPORT_SCHEMA_PATH = path.join(CONTROL_PLANE_ROOT, "src", "lib", "subagent-report.schema.json");

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
  const deskRoot = path.resolve(options.deskRoot || path.join(projectRoot, AGENT_DESK_STATE_DIRNAME));
  const projectKey = `${slug(path.basename(projectRoot))}-${shortHash(projectRoot)}`;
  const worktreesRoot = path.resolve(
    options.worktreesRoot || path.join(os.homedir(), ".agent-desk", "worktrees", projectKey),
  );
  const configPath = path.resolve(options.configPath || options.config || path.join(deskRoot, DEFAULT_CONFIG_FILENAME));
  return {
    projectRoot,
    deskRoot,
    configPath,
    tasksRoot: path.join(deskRoot, "tasks"),
    sessionsRoot: path.join(deskRoot, "sessions"),
    docsRoot: path.join(deskRoot, "docs"),
    locksRoot: path.join(deskRoot, "locks"),
    controlPlaneRoot: CONTROL_PLANE_ROOT,
    worktreesRoot,
    codexCli: resolveCodexCliPath({
      explicitPath: options.codexCli || process.env.CODEX_CLI || process.env.CODEX_CLI_PATH || process.env.CODEX_BIN,
    }),
  };
}

export async function getHealth(context) {
  const [{ runtime, capabilities }, tasks, sessions] = await Promise.all([
    getRuntimeCapabilities(context),
    listTasks(context),
    listSessions(context),
  ]);
  return {
    ok: true,
    projectRoot: context.projectRoot,
    deskRoot: context.deskRoot,
    worktreesRoot: context.worktreesRoot,
    codexRuntime: runtime,
    runtime,
    capabilities,
    counts: {
      tasks: tasks.items.length,
      sessions: sessions.items.length,
    },
  };
}

export async function readAgentDeskConfig(context) {
  const exists = Boolean(await statSafe(context.configPath));
  const text = exists ? await fsp.readFile(context.configPath, "utf8") : "";
  const raw = exists ? parseAgentDeskConfigToml(text) : {};
  const sessionInput = normalizeSessionRequestInput(raw.session || {});
  return {
    path: context.configPath,
    exists,
    raw,
    session: normalizeSessionRequest(sessionInput),
    text: exists ? text : renderAgentDeskConfigToml(),
  };
}

export async function writeDefaultAgentDeskConfig(context, options = {}) {
  const exists = Boolean(await statSafe(context.configPath));
  if (exists && !options.force) {
    throw new Error(`config already exists: ${context.configPath}`);
  }
  await fsp.mkdir(path.dirname(context.configPath), { recursive: true });
  await fsp.writeFile(context.configPath, renderAgentDeskConfigToml(options.session || {}), "utf8");
  return readAgentDeskConfig(context);
}

export function renderAgentDeskConfigToml(config = {}) {
  const session = normalizeSessionRequest(normalizeSessionRequestInput(config.session || config));
  return [
    "# AgentDesk project configuration",
    "",
    "[session]",
    `model = ${tomlString(session.model)}`,
    `reasoning = ${tomlString(session.reasoning)}`,
    `parallelism = ${session.parallelism}`,
    `execution_mode = ${tomlString(session.executionMode)}`,
    `subagent_launcher = ${tomlString(session.subagentLauncher)}`,
    "",
    "# execution_mode = \"auto\" lets the main agent avoid worktrees for simple or non-conflicting work.",
    "# Use execution_mode = \"worktree\" when parallel branch isolation is required.",
  ].join("\n");
}

export function parseAgentDeskConfigToml(text = "") {
  const root = {};
  let current = root;
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripTomlComment(lines[index]).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1].split(".").reduce((object, part) => {
        object[part] = object[part] && typeof object[part] === "object" && !Array.isArray(object[part])
          ? object[part]
          : {};
        return object[part];
      }, root);
      continue;
    }
    const assignmentMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignmentMatch) {
      throw new Error(`unsupported TOML syntax on line ${index + 1}`);
    }
    current[assignmentMatch[1]] = parseTomlValue(assignmentMatch[2].trim(), index + 1);
  }
  return root;
}

export async function getRuntimeCapabilities(context) {
  const [codexDiscovery, codexVersion] = await Promise.all([
    discoverCodexModels({ codexCliPath: context.codexCli, timeoutMs: 1000 }),
    detectCodexVersion(context.codexCli),
  ]);
  const codexModels = Array.isArray(codexDiscovery.models) ? codexDiscovery.models : [];
  const reasoningEfforts = Array.isArray(codexDiscovery.reasoningEfforts)
    ? codexDiscovery.reasoningEfforts
    : CODEX_REASONING_EFFORT_OPTIONS;
  const fast = normalizeFastMetadata(codexDiscovery.fast);
  const modelChoices = codexModels.map((model) => ({
    value: model.slug,
    label: model.displayName,
    description: model.description,
    defaultReasoning: model.defaultReasoningEffort,
    reasoningEfforts: model.reasoningEfforts,
    supportsFast: Boolean(model.fast?.supported),
  }));
  const runtimeMetadata = {
    source: codexDiscovery.source || "fallback",
    codexCliPath: codexDiscovery.codexCliPath || context.codexCli || "codex",
    modelChoices,
    models: modelChoices,
    reasoningEfforts,
    reasoningOptions: reasoningEfforts,
    fast,
    supportsFast: fast.supported,
    lastErrors: Array.isArray(codexDiscovery.errors) ? codexDiscovery.errors : [],
    defaults: {
      model: DEFAULT_SUBAGENT_MODEL,
      reasoning: DEFAULT_SUBAGENT_REASONING,
      serviceTier: DEFAULT_SERVICE_TIER,
      batchSize: DEFAULT_LAUNCH_BATCH_SIZE,
      parallelism: DEFAULT_PARALLELISM,
    },
  };
  return {
    runtime: {
      id: "codex-cli",
      name: "Codex CLI",
      codexBin: runtimeMetadata.codexCliPath,
      codexVersion,
      available: runtimeMetadata.source === "codex-cli",
      metadata: runtimeMetadata,
      ...runtimeMetadata,
    },
    capabilities: {
      tasks: {
        generation: true,
        markdownOnly: true,
      },
      sessions: {
        worktrees: true,
        currentBranchAnalysis: true,
        masterIntegration: true,
        batchSize: DEFAULT_LAUNCH_BATCH_SIZE,
        fixedModel: DEFAULT_SUBAGENT_MODEL,
        fixedReasoning: DEFAULT_SUBAGENT_REASONING,
        fixedServiceTier: DEFAULT_SERVICE_TIER,
        defaultExecutionMode: DEFAULT_EXECUTION_MODE,
        executionModes: EXECUTION_MODES,
        concreteExecutionModes: CONCRETE_EXECUTION_MODES,
        currentBranchSubagentLaunchers: CURRENT_BRANCH_SUBAGENT_LAUNCHERS,
      },
    },
  };
}

export async function listTasks(context) {
  const entries = await readdirSafe(context.tasksRoot, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const meta = await readTaskMeta(context, entry.name).catch(() => null);
    if (!meta) {
      continue;
    }
    items.push(await enrichTaskSummary(context, meta));
  }
  items.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  return { items };
}

export async function getTask(context, taskId) {
  const meta = await readTaskMeta(context, taskId);
  const sessions = await listSessions(context, { taskId });
  const memoryPath = resolveTaskMemoryPath(context, meta);
  return {
    ...meta,
    markdown: await readTextSafe(meta.paths.taskMd),
    memory: await readTaskMemory(context, meta),
    memoryPath,
    sessions: sessions.items,
  };
}

export async function createTask(context, request = {}) {
  const normalized = normalizeTaskRequest(request);
  const similarTasks = await findSimilarTasks(context, normalized);
  if (similarTasks.length > 0) {
    if (normalized.similarTaskAction === "confirm") {
      return buildSimilarTaskConfirmation(normalized, similarTasks);
    }
    if (normalized.similarTaskAction === "continue") {
      return {
        ...similarTasks[0],
        requiresConfirmation: false,
        reusedExistingTask: true,
        similarTaskAction: "continue",
        similarTasks,
      };
    }
  } else if (normalized.similarTaskAction === "continue") {
    throw new Error("no similar AgentDesk task found to continue");
  }

  await assertExecutable(context.codexCli || "codex", "codex CLI");
  await fsp.mkdir(context.tasksRoot, { recursive: true });
  const { taskId, taskDir } = await allocateTaskDir(context, normalized);
  const now = new Date().toISOString();
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    taskId,
    title: normalized.title,
    brief: normalized.brief,
    status: "received",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    lastError: "",
    subtaskCount: 0,
    activeSessionId: "",
    activeSessionStartedAt: null,
    activeSessionStatus: "",
    paths: {
      taskDir,
      briefMd: path.join(taskDir, "brief.md"),
      promptMd: path.join(taskDir, "prompt.md"),
      taskMd: path.join(taskDir, "task.md"),
      memoryMd: path.join(taskDir, DEFAULT_TASK_MEMORY_FILENAME),
      metaJson: path.join(taskDir, "meta.json"),
      stdoutLog: path.join(taskDir, "stdout.log"),
      stderrLog: path.join(taskDir, "stderr.log"),
    },
  };
  await fsp.writeFile(meta.paths.briefMd, normalized.brief, "utf8");
  await fsp.writeFile(meta.paths.memoryMd, renderInitialTaskMemory(meta), "utf8");
  await fsp.writeFile(meta.paths.stdoutLog, "", "utf8");
  await fsp.writeFile(meta.paths.stderrLog, "", "utf8");
  await writeJsonAtomic(meta.paths.metaJson, meta);

  const workerPath = path.join(CONTROL_PLANE_ROOT, "src", "worker", "run-agent-desk-job.mjs");
  const child = spawn(process.execPath, [
    workerPath,
    "--project",
    context.projectRoot,
    "--desk-root",
    context.deskRoot,
    "--worktrees-root",
    context.worktreesRoot,
    "--config",
    context.configPath,
    "--codex-cli",
    context.codexCli,
    "--job",
    "generate-task",
    "--task",
    taskId,
  ], {
    cwd: context.projectRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const summary = await enrichTaskSummary(context, {
    ...meta,
    pid: child.pid,
  });
  return {
    ...summary,
    requiresConfirmation: false,
    similarTaskAction: normalized.similarTaskAction,
    similarTasks: normalized.similarTaskAction === "rebuild" ? similarTasks : [],
  };
}

export async function runTaskGenerationJob(context, taskId) {
  const meta = await readTaskMeta(context, taskId);
  const prompt = buildTaskGenerationPrompt(meta);
  await fsp.writeFile(meta.paths.promptMd, prompt, "utf8");
  await updateTaskMeta(context, taskId, {
    status: "generating",
    lastError: "",
  });

  const result = await runCodexPrompt({
    context,
    cwd: context.projectRoot,
    model: DEFAULT_SUBAGENT_MODEL,
    reasoning: DEFAULT_SUBAGENT_REASONING,
    serviceTier: DEFAULT_SERVICE_TIER,
    prompt,
    outputFile: meta.paths.taskMd,
    stdoutLog: meta.paths.stdoutLog,
    stderrLog: meta.paths.stderrLog,
    skipGitRepoCheck: true,
  });
  if (result.exitCode !== 0) {
    const error = describeCommandFailure(result, "task generation failed");
    await updateTaskMeta(context, taskId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      lastError: error,
    });
    throw new Error(error);
  }

  const markdown = await readTextSafe(meta.paths.taskMd);
  if (!markdown.trim()) {
    const error = "Codex returned an empty task markdown document";
    await updateTaskMeta(context, taskId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      lastError: error,
    });
    throw new Error(error);
  }

  const items = parseTaskMarkdownItems(markdown);
  const title = extractMarkdownTitle(markdown) || meta.title;
  await updateTaskMeta(context, taskId, {
    title,
    status: "ready",
    completedAt: new Date().toISOString(),
    subtaskCount: items.length,
    lastError: "",
  });
  return getTask(context, taskId);
}

export async function listSessions(context, options = {}) {
  const entries = await readdirSafe(context.sessionsRoot, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const meta = await readSessionMeta(context, entry.name).catch(() => null);
    if (!meta) {
      continue;
    }
    if (options.taskId && meta.taskId !== options.taskId) {
      continue;
    }
    items.push(await enrichSessionSummary(context, await settleCodexAppLaunchPlanSession(context, meta)));
  }
  items.sort(compareSessionsByRecency);
  return { items };
}

export async function getSession(context, sessionId) {
  const meta = await settleCodexAppLaunchPlanSession(context, await readSessionMeta(context, sessionId));
  const task = await readTaskMeta(context, meta.taskId).catch(() => null);
  const docContent = await readTextSafe(meta.paths.docMd);
  return {
    ...meta,
    task: task ? {
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      path: task.paths.taskMd,
    } : null,
    docContent: docContent.trim() ? docContent : renderSessionDocument(meta, task),
  };
}

function compareSessionsByRecency(left, right) {
  const stampOrder = String(sessionRecencyStamp(right)).localeCompare(String(sessionRecencyStamp(left)));
  if (stampOrder !== 0) {
    return stampOrder;
  }
  return String(right.sessionId || "").localeCompare(String(left.sessionId || ""));
}

function sessionRecencyStamp(session) {
  return session.updatedAt
    || session.completedAt
    || session.startedAt
    || session.createdAt
    || session.sessionId
    || "";
}

export async function createSession(context, taskId, request = {}) {
  const task = await readTaskMeta(context, taskId);
  if (!TASK_STATUSES.has(task.status) || !["ready", "running", "succeeded", "failed"].includes(task.status)) {
    throw new Error(`task is not ready to execute: ${task.status}`);
  }
  await assertGitRepository(context.projectRoot);

  const sessionRequest = await resolveSessionRequest(context, task, request);
  const waitForCompletion = normalizeBoolean(
    request.waitForCompletion ?? request.wait_for_completion,
    "waitForCompletion",
  );
  if (sessionRequest.executionMode === "worktree") {
    await assertMasterBranch(context.projectRoot);
  }
  const allowDuplicateSession = normalizeBoolean(
    request.allowDuplicateSession ?? request.allow_duplicate_session ?? request.force,
    "allowDuplicateSession",
  );
  const { task: claimedTask, session: meta } = await createClaimedSessionMeta(context, taskId, sessionRequest, {
    allowDuplicateSession,
  });
  const sessionId = meta.sessionId;

  if (sessionRequest.executionMode === "current-branch" && sessionRequest.subagentLauncher === "codex-app") {
    try {
      await prepareCodexAppSession(context, claimedTask, sessionId);
      await finishTaskActiveSession(context, taskId, sessionId, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        lastError: "",
      });
      return enrichSessionSummary(context, await readSessionMeta(context, sessionId));
    } catch (error) {
      const message = error.message || String(error);
      await updateSessionMeta(context, sessionId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        lastError: message,
      }).catch(() => {});
      await finishTaskActiveSession(context, taskId, sessionId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        lastError: message,
      }).catch(() => {});
      throw error;
    }
  }

  if (waitForCompletion) {
    return runSessionJobAndReturnStatus(context, taskId, sessionId);
  }

  try {
    const workerPath = path.join(CONTROL_PLANE_ROOT, "src", "worker", "run-agent-desk-job.mjs");
    const child = spawn(process.execPath, [
      workerPath,
      "--project",
      context.projectRoot,
      "--desk-root",
      context.deskRoot,
      "--worktrees-root",
      context.worktreesRoot,
      "--config",
      context.configPath,
      "--codex-cli",
      context.codexCli,
      "--job",
      "run-session",
      "--session",
      sessionId,
    ], {
      cwd: context.projectRoot,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (error) {
    const message = error.message || String(error);
    await updateSessionMeta(context, sessionId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      lastError: message,
    }).catch(() => {});
    await finishTaskActiveSession(context, taskId, sessionId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      lastError: message,
    }).catch(() => {});
    throw error;
  }

  return enrichSessionSummary(context, meta);
}

async function createClaimedSessionMeta(context, taskId, sessionRequest, options = {}) {
  const lock = await acquireLock(path.join(context.locksRoot, `task-${taskId}.lock`));
  try {
    const task = await readTaskMeta(context, taskId);
    if (!TASK_STATUSES.has(task.status) || !["ready", "running", "succeeded", "failed"].includes(task.status)) {
      throw new Error(`task is not ready to execute: ${task.status}`);
    }
    if (task.activeSessionId && !options.allowDuplicateSession) {
      const status = task.activeSessionStatus ? ` (${task.activeSessionStatus})` : "";
      throw new Error(`task already has an active session: ${task.activeSessionId}${status}`);
    }

    const { sessionId, sessionDir } = await allocateSessionDir(context, task);
    const now = new Date().toISOString();
    const meta = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      taskId: task.taskId,
      title: task.title,
      status: "queued",
      parallelism: sessionRequest.parallelism,
      batchSize: DEFAULT_LAUNCH_BATCH_SIZE,
      model: sessionRequest.model,
      reasoning: sessionRequest.reasoning,
      serviceTier: sessionRequest.serviceTier,
      executionMode: sessionRequest.executionMode,
      requestedExecutionMode: sessionRequest.requestedExecutionMode,
      subagentLauncher: sessionRequest.subagentLauncher,
      launchPrompt: sessionRequest.launchPrompt,
      worktreeDecision: sessionRequest.worktreeDecision,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      lastError: "",
      totalAgents: 0,
      succeededAgents: 0,
      failedAgents: 0,
      runningAgents: 0,
      agents: [],
      paths: {
        sessionDir,
        metaJson: path.join(sessionDir, "meta.json"),
        docMd: path.join(sessionDir, "session.md"),
        stdoutLog: path.join(sessionDir, "stdout.log"),
        stderrLog: path.join(sessionDir, "stderr.log"),
      },
    };
    await fsp.writeFile(meta.paths.stdoutLog, "", "utf8");
    await fsp.writeFile(meta.paths.stderrLog, "", "utf8");
    await writeJsonAtomic(meta.paths.metaJson, meta);

    const updatedTask = {
      ...task,
      status: "running",
      updatedAt: now,
      completedAt: null,
      lastError: "",
      activeSessionId: sessionId,
      activeSessionStartedAt: now,
      activeSessionStatus: "queued",
    };
    await writeJsonAtomic(path.join(taskDirPath(context, task.taskId), "meta.json"), updatedTask);
    return { task: updatedTask, session: meta };
  } finally {
    await releaseLock(lock);
  }
}

async function runSessionJobAndReturnStatus(context, taskId, sessionId) {
  try {
    return enrichSessionSummary(context, await runSessionJob(context, sessionId));
  } catch (error) {
    const message = error.message || String(error);
    await updateSessionMeta(context, sessionId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      lastError: message,
    }).catch(() => {});
    await finishTaskActiveSession(context, taskId, sessionId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      lastError: message,
    }).catch(() => {});
    return enrichSessionSummary(context, await readSessionMeta(context, sessionId));
  }
}

export async function getCodexAppLaunchPlan(context, sessionId) {
  const session = await getSession(context, sessionId);
  const requiresHostLaunch = getSessionSubagentLauncher(session) === "codex-app";
  const subagents = requiresHostLaunch
    ? await Promise.all((session.agents || []).map(async (agent) => {
      const paths = agent.paths || {};
      return {
        agentId: agent.id,
        title: agent.title,
        status: agent.status,
        taskSnapshotPath: paths.taskSnapshotMd || "",
        memorySnapshotPath: paths.memorySnapshotMd || "",
        promptPath: paths.promptMd || "",
        prompt: paths.promptMd ? await readTextSafe(paths.promptMd) : "",
      };
    }))
    : [];
  return {
    sessionId,
    requiresHostLaunch,
    launchTool: requiresHostLaunch ? "spawn_agent" : "",
    parallelism: session.parallelism,
    subagents,
  };
}

async function prepareCodexAppSession(context, task, sessionId) {
  const session = await readSessionMeta(context, sessionId);
  const taskMarkdown = await readTextSafe(task.paths.taskMd);
  const taskMemory = await readTaskMemory(context, task);
  const parsedItems = parseTaskMarkdownItems(taskMarkdown);
  if (parsedItems.length === 0) {
    const error = "task.md does not contain any executable subtasks";
    await updateSessionMeta(context, sessionId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      lastError: error,
    });
    throw new Error(error);
  }

  const baseCommit = await gitRevParse(context.projectRoot, "HEAD");
  const branchName = await gitCurrentBranch(context.projectRoot).catch(() => "current-branch");
  const agents = parsedItems.map((item, index) => {
    const agentId = `agent-${String(index + 1).padStart(2, "0")}`;
    const agentDir = path.join(session.paths.sessionDir, "agents", agentId);
    return {
      id: agentId,
      order: index + 1,
      title: item.title,
      detail: item.detail,
      status: "prepared_for_app",
      branchName,
      worktreePath: context.projectRoot,
      baseCommit,
      headCommit: "",
      mergedCommit: "",
      changedFiles: [],
      testsRun: [],
      risks: [],
      notes: [],
      summary: "",
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      exitCode: null,
      lastError: "",
      paths: {
        ...buildAgentPaths(agentDir),
      },
    };
  });

  for (const agent of agents) {
    await writeAgentContextSnapshots(agent, taskMarkdown, taskMemory);
    await writeAgentPromptSnapshot(task, taskMarkdown, taskMemory, session, sessionId, agent);
  }

  await updateSessionMeta(context, sessionId, {
    status: "succeeded",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    lastError: "",
    totalAgents: agents.length,
    agents,
  });
  await refreshSessionCounts(context, sessionId);
  await writeSessionDocumentation(context, sessionId);
}

async function settleCodexAppLaunchPlanSession(context, session) {
  if (getSessionSubagentLauncher(session) !== "codex-app" || session.status !== "waiting_for_app") {
    return session;
  }
  const now = new Date().toISOString();
  const agents = (session.agents || []).map((agent) => {
    if (agent.status !== "queued") {
      return agent;
    }
    return {
      ...agent,
      status: "prepared_for_app",
      updatedAt: agent.updatedAt || now,
    };
  });
  await updateSessionMeta(context, session.sessionId, {
    status: "succeeded",
    completedAt: session.completedAt || now,
    lastError: "",
    agents,
  });
  await refreshSessionCounts(context, session.sessionId);
  await writeSessionDocumentation(context, session.sessionId).catch(() => {});
  return readSessionMeta(context, session.sessionId);
}

export async function runSessionJob(context, sessionId) {
  const session = await readSessionMeta(context, sessionId);
  const task = await readTaskMeta(context, session.taskId);
  const markdown = await readTextSafe(task.paths.taskMd);
  const parsedItems = parseTaskMarkdownItems(markdown);
  if (parsedItems.length === 0) {
    const error = "task.md does not contain any executable subtasks";
    await updateSessionMeta(context, sessionId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      lastError: error,
    });
    await finishTaskActiveSession(context, task.taskId, sessionId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      lastError: error,
    });
    throw new Error(error);
  }

  const agents = parsedItems.map((item, index) => {
    const agentId = `agent-${String(index + 1).padStart(2, "0")}`;
    const agentDir = path.join(session.paths.sessionDir, "agents", agentId);
    const executionMode = getSessionExecutionMode(session);
    const worktreePath = executionMode === "worktree"
      ? path.join(context.worktreesRoot, sessionId, agentId)
      : context.projectRoot;
    const branchName = executionMode === "worktree"
      ? `agentdesk/${task.taskId}/${sessionId}/${agentId}`
      : "current-branch";
    return {
      id: agentId,
      order: index + 1,
      title: item.title,
      detail: item.detail,
      status: "queued",
      branchName,
      worktreePath,
      baseCommit: "",
      headCommit: "",
      mergedCommit: "",
      changedFiles: [],
      testsRun: [],
      risks: [],
      notes: [],
      summary: "",
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      exitCode: null,
      lastError: "",
      paths: {
        ...buildAgentPaths(agentDir),
      },
    };
  });

  const taskMemory = await readTaskMemory(context, task);
  for (const agent of agents) {
    await writeAgentContextSnapshots(agent, markdown, taskMemory);
  }

  await updateSessionMeta(context, sessionId, {
    status: "running",
    startedAt: new Date().toISOString(),
    lastError: "",
    totalAgents: agents.length,
    agents,
  });
  await updateTaskActiveSessionStatus(context, task.taskId, sessionId, "running");
  await writeSessionDocumentation(context, sessionId);

  const pending = [...agents];
  const running = new Map();

  while (pending.length > 0 || running.size > 0) {
    const availableSlots = Math.max(0, session.parallelism - running.size);
    const launchCount = Math.min(DEFAULT_LAUNCH_BATCH_SIZE, availableSlots, pending.length);
    for (let index = 0; index < launchCount; index += 1) {
      const nextAgent = pending.shift();
      if (!nextAgent) {
        break;
      }
      const promise = runSingleAgent(context, task, session, sessionId, nextAgent)
        .then((result) => ({ agentId: nextAgent.id, result }))
        .catch((error) => ({ agentId: nextAgent.id, error }));
      running.set(nextAgent.id, promise);
    }

    if (running.size === 0) {
      continue;
    }

    const settled = await Promise.race([...running.values()]);
    running.delete(settled.agentId);
    if (settled.error) {
      appendFileSyncSafe(session.paths.stderrLog, `${settled.agentId}: ${settled.error.message}\n`);
    }
    await refreshSessionCounts(context, sessionId);
    await writeSessionDocumentation(context, sessionId);
  }

  const finalSession = await readSessionMeta(context, sessionId);
  const finalStatus = finalSession.failedAgents > 0 ? "failed" : "succeeded";
  await updateSessionMeta(context, sessionId, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    lastError: finalStatus === "failed" ? finalSession.lastError : "",
  });
  await finishTaskActiveSession(context, task.taskId, sessionId, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    lastError: finalStatus === "failed" ? finalSession.lastError : "",
  });
  await writeSessionDocumentation(context, sessionId);
  return getSession(context, sessionId);
}

async function runSingleAgent(context, task, session, sessionId, agent) {
  if (getSessionExecutionMode(session) === "current-branch") {
    return runSingleCurrentBranchAgent(context, task, session, sessionId, agent);
  }

  let created = null;
  try {
    await fsp.mkdir(agent.paths.agentDir, { recursive: true });
    await fsp.writeFile(agent.paths.stdoutLog, "", "utf8");
    await fsp.writeFile(agent.paths.stderrLog, "", "utf8");

    created = await prepareAgentWorktree(context, agent);
    const { taskMarkdown, taskMemory } = await readAgentContextSnapshots(context, task, agent);
    await writeAgentPromptSnapshot(task, taskMarkdown, taskMemory, session, sessionId, {
      ...agent,
      worktreePath: created.worktreePath,
      branchName: created.branchName,
      baseCommit: created.baseCommit,
    });
    const prompt = await readTextSafe(agent.paths.promptMd);

    await patchSessionAgent(context, sessionId, agent.id, {
      status: "running",
      worktreePath: created.worktreePath,
      branchName: created.branchName,
      baseCommit: created.baseCommit,
      startedAt: new Date().toISOString(),
      lastError: "",
    });
    await refreshSessionCounts(context, sessionId);

    const result = await runCodexPrompt({
      context,
      cwd: created.worktreePath,
      model: session.model || DEFAULT_SUBAGENT_MODEL,
      reasoning: session.reasoning || DEFAULT_SUBAGENT_REASONING,
      serviceTier: session.serviceTier || DEFAULT_SERVICE_TIER,
      prompt,
      outputFile: agent.paths.reportJson,
      stdoutLog: agent.paths.stdoutLog,
      stderrLog: agent.paths.stderrLog,
      outputSchemaFile: SUBAGENT_REPORT_SCHEMA_PATH,
    });
    if (result.exitCode !== 0) {
      throw new Error(describeCommandFailure(result, `subagent ${agent.id} failed`));
    }

    const report = await readJsonSafe(agent.paths.reportJson);
    const normalizedReport = normalizeSubagentReport(report);
    const commitInfo = await finalizeAgentBranch(context, created.worktreePath, created.branchName, created.baseCommit, agent.title);
    const changedFiles = await listBranchFiles(created.worktreePath, created.baseCommit);
    const integration = await integrateBranchIntoMaster(context, created.worktreePath, created.baseCommit, commitInfo.headCommit);

    await patchSessionAgent(context, sessionId, agent.id, {
      status: "succeeded",
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: normalizedReport.summary,
      testsRun: normalizedReport.testsRun,
      risks: normalizedReport.risks,
      notes: normalizedReport.notes,
      changedFiles,
      headCommit: commitInfo.headCommit,
      mergedCommit: integration.masterCommit,
      lastError: "",
    });
    const updatedAgent = await getSessionAgent(context, sessionId, agent.id);
    await persistAgentMemory(context, task, sessionId, updatedAgent, agent.paths.stderrLog);
    return {
      report: normalizedReport,
      changedFiles,
      integration,
    };
  } catch (error) {
    await patchSessionAgent(context, sessionId, agent.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      worktreePath: created?.worktreePath || agent.worktreePath,
      branchName: created?.branchName || agent.branchName,
      baseCommit: created?.baseCommit || agent.baseCommit,
      lastError: error.message,
    });
    const failedAgent = await getSessionAgent(context, sessionId, agent.id);
    await persistAgentMemory(context, task, sessionId, failedAgent, agent.paths.stderrLog);
    await updateSessionLastError(context, sessionId, error.message);
    throw error;
  }
}

async function runSingleCurrentBranchAgent(context, task, session, sessionId, agent) {
  try {
    await fsp.mkdir(agent.paths.agentDir, { recursive: true });
    await fsp.writeFile(agent.paths.stdoutLog, "", "utf8");
    await fsp.writeFile(agent.paths.stderrLog, "", "utf8");

    const baseCommit = await gitRevParse(context.projectRoot, "HEAD");
    const branchName = await gitCurrentBranch(context.projectRoot).catch(() => "current-branch");
    const filesBefore = await listCurrentBranchChangedFiles(context.projectRoot);
    const { taskMarkdown, taskMemory } = await readAgentContextSnapshots(context, task, agent);
    await writeAgentPromptSnapshot(task, taskMarkdown, taskMemory, session, sessionId, {
      ...agent,
      branchName,
      worktreePath: context.projectRoot,
      baseCommit,
    });
    const prompt = await readTextSafe(agent.paths.promptMd);

    await patchSessionAgent(context, sessionId, agent.id, {
      status: "running",
      worktreePath: context.projectRoot,
      branchName,
      baseCommit,
      startedAt: new Date().toISOString(),
      lastError: "",
    });
    await refreshSessionCounts(context, sessionId);

    const result = await runCodexPrompt({
      context,
      cwd: context.projectRoot,
      model: session.model || DEFAULT_SUBAGENT_MODEL,
      reasoning: session.reasoning || DEFAULT_SUBAGENT_REASONING,
      serviceTier: session.serviceTier || DEFAULT_SERVICE_TIER,
      prompt,
      outputFile: agent.paths.reportJson,
      stdoutLog: agent.paths.stdoutLog,
      stderrLog: agent.paths.stderrLog,
      outputSchemaFile: SUBAGENT_REPORT_SCHEMA_PATH,
    });
    if (result.exitCode !== 0) {
      throw new Error(describeCommandFailure(result, `current-branch subagent ${agent.id} failed`));
    }

    const report = await readJsonSafe(agent.paths.reportJson);
    const normalizedReport = normalizeSubagentReport(report);
    const filesAfter = await listCurrentBranchChangedFiles(context.projectRoot);
    const changedFiles = diffChangedFiles(filesBefore, filesAfter);
    const headCommit = await gitRevParse(context.projectRoot, "HEAD");
    await patchSessionAgent(context, sessionId, agent.id, {
      status: "succeeded",
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: normalizedReport.summary,
      testsRun: normalizedReport.testsRun,
      risks: normalizedReport.risks,
      notes: normalizedReport.notes,
      changedFiles,
      headCommit,
      mergedCommit: "",
      lastError: "",
    });
    const updatedAgent = await getSessionAgent(context, sessionId, agent.id);
    await persistAgentMemory(context, task, sessionId, updatedAgent, agent.paths.stderrLog);
    return {
      report: normalizedReport,
      changedFiles,
      integration: {
        masterBefore: "",
        masterCommit: "",
        integrated: false,
      },
    };
  } catch (error) {
    await patchSessionAgent(context, sessionId, agent.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      worktreePath: context.projectRoot,
      branchName: agent.branchName || "current-branch",
      lastError: error.message,
    });
    const failedAgent = await getSessionAgent(context, sessionId, agent.id);
    await persistAgentMemory(context, task, sessionId, failedAgent, agent.paths.stderrLog);
    await updateSessionLastError(context, sessionId, error.message);
    throw error;
  }
}

export async function getAgentLogs(context, sessionId, agentId) {
  const session = await readSessionMeta(context, sessionId);
  const agent = session.agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    throw new Error(`agent not found in session ${sessionId}: ${agentId}`);
  }
  return {
    stdoutLog: agent.paths.stdoutLog,
    stderrLog: agent.paths.stderrLog,
    stdout: await readTextSafe(agent.paths.stdoutLog),
    stderr: await readTextSafe(agent.paths.stderrLog),
  };
}

export async function snapshotStateStamp(context) {
  return String(await newestMtime(context.deskRoot));
}

async function enrichTaskSummary(context, meta) {
  const sessions = await listSessions(context, { taskId: meta.taskId });
  const latestSession = sessions.items[0] || null;
  return {
    ...meta,
    sessionCount: sessions.items.length,
    latestSessionId: latestSession?.sessionId || "",
    latestSessionStatus: latestSession?.status || "",
    latestSessionAt: latestSession?.updatedAt || "",
  };
}

async function enrichSessionSummary(context, meta) {
  const task = await readTaskMeta(context, meta.taskId).catch(() => null);
  return {
    ...meta,
    taskTitle: task?.title || meta.title || meta.taskId,
  };
}

function normalizeTaskRequest(request = {}) {
  const brief = String(request.brief || "").trim();
  if (!brief) {
    throw new Error("brief is required");
  }
  const title = String(request.title || "").trim() || firstSentence(brief);
  const similarTaskAction = normalizeSimilarTaskAction(request.similarTaskAction);
  return { brief, title, similarTaskAction };
}

function normalizeSimilarTaskAction(value) {
  const action = String(value || "confirm").trim().toLowerCase();
  if (!SIMILAR_TASK_ACTIONS.has(action)) {
    throw new Error(`similarTaskAction must be one of: ${[...SIMILAR_TASK_ACTIONS].join(", ")}`);
  }
  return action;
}

async function findSimilarTasks(context, request) {
  const tasks = await listTasks(context);
  const matches = [];
  for (const task of tasks.items) {
    const match = scoreTaskSimilarity(request, task);
    if (match.score >= SIMILAR_TASK_SCORE_THRESHOLD) {
      matches.push({
        ...task,
        similarityScore: Number(match.score.toFixed(3)),
        similarityReason: match.reason,
      });
    }
  }
  matches.sort((left, right) => {
    const scoreOrder = right.similarityScore - left.similarityScore;
    if (scoreOrder !== 0) {
      return scoreOrder;
    }
    return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });
  return matches.slice(0, 5);
}

function buildSimilarTaskConfirmation(request, similarTasks) {
  return {
    requiresConfirmation: true,
    requestedTitle: request.title,
    requestedBrief: request.brief,
    similarTaskAction: "confirm",
    message: "Similar AgentDesk task(s) were found. Confirm whether to continue an existing task or rebuild a fresh task.",
    confirmationChoices: [
      {
        action: "continue",
        description: "Use an existing task by taskId; no new task will be generated.",
      },
      {
        action: "rebuild",
        description: "Generate a fresh task from this request; existing tasks are left untouched.",
      },
    ],
    similarTasks,
  };
}

function scoreTaskSimilarity(request, task) {
  const titleScore = similarityScore(request.title, task.title);
  const briefScore = similarityScore(request.brief, task.brief);
  const combinedScore = similarityScore(
    `${request.title}\n${request.brief}`,
    `${task.title || ""}\n${task.brief || ""}`,
  );
  const score = Math.max(titleScore, briefScore, combinedScore);
  if (score >= 0.98) {
    return { score, reason: "same or near-identical title/brief" };
  }
  if (titleScore === score) {
    return { score, reason: "similar title" };
  }
  if (briefScore === score) {
    return { score, reason: "similar brief" };
  }
  return { score, reason: "similar title and brief" };
}

export function normalizeSessionRequest(request = {}) {
  const normalizedInput = normalizeSessionRequestInput(request);
  const executionMode = normalizeExecutionMode(normalizedInput.executionMode || normalizedInput.mode);
  return {
    parallelism: normalizeParallelism(normalizedInput.parallelism),
    model: normalizeSubagentModel(normalizedInput.model),
    reasoning: normalizeReasoningEffort(normalizedInput.reasoning),
    serviceTier: DEFAULT_SERVICE_TIER,
    executionMode,
    subagentLauncher: normalizeSubagentLauncher(normalizedInput.subagentLauncher, executionMode),
    launchPrompt: normalizeOptionalString(normalizedInput.launchPrompt),
  };
}

async function resolveSessionRequest(context, task, request = {}) {
  const config = await readAgentDeskConfig(context);
  const configRequest = config.exists
    ? normalizeSessionRequestInput(config.raw.session || {})
    : {};
  const normalized = normalizeSessionRequest({
    ...configRequest,
    ...normalizeSessionRequestInput(request),
  });
  const taskMarkdown = task?.paths?.taskMd ? await readTextSafe(task.paths.taskMd) : "";
  const worktreeDecision = chooseExecutionModeForTask(taskMarkdown, normalized);
  return {
    ...normalized,
    requestedExecutionMode: normalized.executionMode,
    executionMode: worktreeDecision.executionMode,
    worktreeDecision,
  };
}

export function chooseExecutionModeForTask(taskMarkdown, request = {}) {
  const requestedExecutionMode = normalizeExecutionMode(request.executionMode || request.mode);
  const subagentLauncher = normalizeSubagentLauncher(request.subagentLauncher, requestedExecutionMode);
  const parallelism = normalizeParallelism(request.parallelism);
  const items = parseTaskMarkdownItems(taskMarkdown);

  if (requestedExecutionMode !== DEFAULT_EXECUTION_MODE) {
    return {
      executionMode: requestedExecutionMode,
      requestedExecutionMode,
      requiresWorktree: requestedExecutionMode === "worktree",
      reason: `explicit ${requestedExecutionMode} execution mode`,
      signals: {
        subtaskCount: items.length,
        parallelism,
        subagentLauncher,
      },
    };
  }

  if (subagentLauncher === "codex-app") {
    return {
      executionMode: "current-branch",
      requestedExecutionMode,
      requiresWorktree: false,
      reason: "codex-app launches are coordinated by the main agent in the current checkout",
      signals: {
        subtaskCount: items.length,
        parallelism,
        subagentLauncher,
      },
    };
  }

  if (items.length <= 1) {
    return {
      executionMode: "current-branch",
      requestedExecutionMode,
      requiresWorktree: false,
      reason: "single executable subtask, so branch isolation is unnecessary",
      signals: {
        subtaskCount: items.length,
        parallelism,
        subagentLauncher,
      },
    };
  }

  if (parallelism <= 1) {
    return {
      executionMode: "current-branch",
      requestedExecutionMode,
      requiresWorktree: false,
      reason: "parallelism is 1, so no concurrent branch isolation is needed",
      signals: {
        subtaskCount: items.length,
        parallelism,
        subagentLauncher,
      },
    };
  }

  const conflictAnalysis = analyzeSubtaskConflicts(items);
  if (!conflictAnalysis.hasConflict && conflictAnalysis.hasEvidence) {
    return {
      executionMode: "current-branch",
      requestedExecutionMode,
      requiresWorktree: false,
      reason: "subtasks mention disjoint implementation paths, so worktree isolation is not required",
      signals: {
        subtaskCount: items.length,
        parallelism,
        subagentLauncher,
        ...conflictAnalysis.signals,
      },
    };
  }

  return {
    executionMode: "worktree",
    requestedExecutionMode,
    requiresWorktree: true,
    reason: conflictAnalysis.reason || "multiple parallel subtasks lack enough non-conflict evidence",
    signals: {
      subtaskCount: items.length,
      parallelism,
      subagentLauncher,
      ...conflictAnalysis.signals,
    },
  };
}

function analyzeSubtaskConflicts(items) {
  const pathsByItem = items.map((item) => extractMentionedPaths(`${item.title}\n${item.detail || ""}`));
  const allPaths = pathsByItem.flatMap((paths) => [...paths]);
  const repeatedPaths = repeatedValues(allPaths);
  if (repeatedPaths.length > 0) {
    return {
      hasConflict: true,
      hasEvidence: true,
      reason: `multiple subtasks mention the same path: ${repeatedPaths.slice(0, 3).join(", ")}`,
      signals: {
        mentionedPaths: uniqueSorted(allPaths),
        repeatedPaths,
      },
    };
  }

  const broadItems = items
    .map((item, index) => ({ index: index + 1, text: `${item.title}\n${item.detail || ""}` }))
    .filter((item) => hasBroadConflictTerms(item.text))
    .map((item) => item.index);
  if (broadItems.length > 0) {
    return {
      hasConflict: true,
      hasEvidence: true,
      reason: `broad or shared-scope wording appears in subtask(s): ${broadItems.join(", ")}`,
      signals: {
        mentionedPaths: uniqueSorted(allPaths),
        broadSubtasks: broadItems,
      },
    };
  }

  const itemsWithPaths = pathsByItem.filter((paths) => paths.size > 0).length;
  return {
    hasConflict: false,
    hasEvidence: itemsWithPaths === items.length && allPaths.length > 0,
    reason: itemsWithPaths === items.length
      ? ""
      : "multiple parallel subtasks do not all name concrete implementation paths",
    signals: {
      mentionedPaths: uniqueSorted(allPaths),
      subtasksWithMentionedPaths: itemsWithPaths,
    },
  };
}

function extractMentionedPaths(text) {
  const matches = String(text || "").match(
    /[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+|[A-Za-z0-9_.@-]+\.(?:cjs|css|go|html|java|js|json|jsx|lock|md|mjs|py|rs|scss|toml|ts|tsx|yaml|yml)\b/g,
  ) || [];
  return new Set(matches.map(normalizeMentionedPath).filter(Boolean));
}

function normalizeMentionedPath(value) {
  return String(value || "")
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^[./]+/, "")
    .replace(/[),.;:]+$/g, "");
}

function hasBroadConflictTerms(text) {
  return /\b(api|common|config|database|dependency|deps|global|layout|lockfile|migration|package|refactor|rename|routing|schema|shared|state|style|styles|theme|types?)\b/i.test(text);
}

function repeatedValues(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
      continue;
    }
    seen.add(value);
  }
  return uniqueSorted([...repeated]);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeSessionRequestInput(input = {}) {
  return definedObject({
    parallelism: input.parallelism ?? input.parallel ?? input.concurrency ?? input.codex_count ?? input["codex-count"],
    model: input.model,
    reasoning: input.reasoning ?? input.effort,
    executionMode: input.executionMode ?? input.execution_mode ?? input.mode,
    subagentLauncher: input.subagentLauncher ?? input.subagent_launcher,
    launchPrompt: input.launchPrompt ?? input.launch_prompt,
  });
}

function normalizeParallelism(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PARALLELISM;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("parallelism must be a positive number");
  }
  return Math.max(1, Math.min(MAX_PARALLELISM, Math.floor(number)));
}

function normalizeSubagentModel(value) {
  const model = normalizeOptionalString(value) || DEFAULT_SUBAGENT_MODEL;
  if (/\s/.test(model)) {
    throw new Error("model must be a single Codex CLI model id");
  }
  return model;
}

function normalizeReasoningEffort(value) {
  const effort = normalizeOptionalString(value) || DEFAULT_SUBAGENT_REASONING;
  if (!SUPPORTED_REASONING_EFFORTS.has(effort)) {
    throw new Error(`unsupported reasoning effort: ${effort}`);
  }
  return effort;
}

function normalizeExecutionMode(value) {
  const mode = normalizeOptionalString(value) || DEFAULT_EXECUTION_MODE;
  if (!EXECUTION_MODES.includes(mode)) {
    throw new Error(`unsupported execution mode: ${mode}`);
  }
  return mode;
}

function normalizeSubagentLauncher(value, executionMode) {
  const launcher = normalizeOptionalString(value);
  if (executionMode === DEFAULT_EXECUTION_MODE) {
    if (!launcher) {
      return DEFAULT_WORKTREE_SUBAGENT_LAUNCHER;
    }
    if (![DEFAULT_WORKTREE_SUBAGENT_LAUNCHER, ...CURRENT_BRANCH_SUBAGENT_LAUNCHERS].includes(launcher)) {
      throw new Error(`unsupported subagent launcher: ${launcher}`);
    }
    return launcher;
  }
  if (executionMode === "worktree") {
    const selected = launcher || DEFAULT_WORKTREE_SUBAGENT_LAUNCHER;
    if (selected !== DEFAULT_WORKTREE_SUBAGENT_LAUNCHER) {
      throw new Error("worktree execution mode only supports codex-cli subagent launcher");
    }
    return selected;
  }
  const selected = launcher || DEFAULT_WORKTREE_SUBAGENT_LAUNCHER;
  if (!CURRENT_BRANCH_SUBAGENT_LAUNCHERS.includes(selected)) {
    throw new Error(`unsupported current-branch subagent launcher: ${selected}`);
  }
  return selected;
}

function getSessionExecutionMode(session) {
  return CONCRETE_EXECUTION_MODES.includes(session?.executionMode)
    ? session.executionMode
    : "worktree";
}

function getSessionSubagentLauncher(session) {
  if (session?.subagentLauncher) {
    return session.subagentLauncher;
  }
  return getSessionExecutionMode(session) === "worktree"
    ? DEFAULT_WORKTREE_SUBAGENT_LAUNCHER
    : "";
}

function normalizeFastMetadata(fast) {
  const supportedModels = Array.isArray(fast?.supportedModels) ? fast.supportedModels.map(String) : [];
  return {
    supported: Boolean(fast?.supported || supportedModels.length > 0),
    tier: normalizeOptionalString(fast?.tier) || DEFAULT_SERVICE_TIER,
    source: normalizeOptionalString(fast?.source),
    supportedModels,
  };
}

async function detectCodexVersion(codexCli) {
  const result = await spawnCapture(codexCli || "codex", ["--version"]);
  return firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr);
}

function buildTaskGenerationPrompt(task) {
  return [
    "You are generating a task markdown file for AgentDesk.",
    "",
    "Write markdown only.",
    "Do not return JSON.",
    "Produce a practical engineering task document with these sections in order:",
    "1. # Title",
    "2. ## Goal",
    "3. ## Context",
    "4. ## Acceptance Criteria",
    "5. ## Subtasks",
    "",
    "Subtask rules:",
    "- Use markdown checkboxes like `- [ ] ...`.",
    "- Each subtask should be implementable by one Codex subagent, but do not assume a git worktree is required.",
    "- Mention concrete file or module paths in subtasks when that helps the main agent detect non-conflicting work.",
    "- Prefer 4 to 12 subtasks.",
    "- Keep subtasks concrete and code-oriented.",
    "- Avoid PRD phrasing and do not mention prd.json.",
    "",
    `Task title hint: ${task.title}`,
    "",
    "Feature brief:",
    task.brief,
  ].join("\n");
}

function buildAgentPaths(agentDir) {
  return {
    agentDir,
    taskSnapshotMd: path.join(agentDir, AGENT_TASK_SNAPSHOT_FILENAME),
    memorySnapshotMd: path.join(agentDir, AGENT_MEMORY_SNAPSHOT_FILENAME),
    promptMd: path.join(agentDir, "prompt.md"),
    reportJson: path.join(agentDir, "report.json"),
    stdoutLog: path.join(agentDir, "stdout.log"),
    stderrLog: path.join(agentDir, "stderr.log"),
  };
}

async function writeAgentContextSnapshots(agent, taskMarkdown, taskMemory) {
  await fsp.mkdir(agent.paths.agentDir, { recursive: true });
  await Promise.all([
    fsp.writeFile(agent.paths.taskSnapshotMd, taskMarkdown, "utf8"),
    fsp.writeFile(agent.paths.memorySnapshotMd, taskMemory, "utf8"),
    fsp.writeFile(agent.paths.stdoutLog, "", "utf8"),
    fsp.writeFile(agent.paths.stderrLog, "", "utf8"),
  ]);
}

async function readAgentContextSnapshots(context, task, agent) {
  const [taskSnapshot, memorySnapshot] = await Promise.all([
    readTextSafe(agent.paths.taskSnapshotMd),
    readTextSafe(agent.paths.memorySnapshotMd),
  ]);
  return {
    taskMarkdown: taskSnapshot || await readTextSafe(task.paths.taskMd),
    taskMemory: memorySnapshot || await readTaskMemory(context, task),
  };
}

async function writeAgentPromptSnapshot(task, taskMarkdown, taskMemory, session, sessionId, agent, options = {}) {
  const prompt = (options.analysis || getSessionExecutionMode(session) === "current-branch")
    ? buildCurrentBranchSubagentPrompt(task, taskMarkdown, taskMemory, session, sessionId, agent)
    : buildSubagentPrompt(task, taskMarkdown, taskMemory, session, sessionId, agent);
  await fsp.writeFile(agent.paths.promptMd, prompt, "utf8");
  return prompt;
}

function buildSubagentPrompt(task, taskMarkdown, taskMemory, session, sessionId, agent) {
  return [
    "You are one AgentDesk execution subagent working in your own git worktree.",
    "",
    `Task ID: ${task.taskId}`,
    `Session ID: ${sessionId}`,
    `Execution model: ${session.model || DEFAULT_SUBAGENT_MODEL}`,
    `Execution reasoning: ${session.reasoning || DEFAULT_SUBAGENT_REASONING}`,
    `Execution mode: ${getSessionExecutionMode(session)}`,
    `Subagent launcher: ${getSessionSubagentLauncher(session)}`,
    `Assigned subtask: ${agent.title}`,
    `Branch: ${agent.branchName}`,
    `Worktree: ${agent.worktreePath}`,
    "",
    "Context snapshot files:",
    `- Task markdown snapshot: ${agent.paths.taskSnapshotMd}`,
    `- Shared memory snapshot: ${agent.paths.memorySnapshotMd}`,
    `- Prompt snapshot: ${agent.paths.promptMd}`,
    "",
    "Rules:",
    "- Work only on the assigned subtask.",
    "- Stay inside the current git worktree and current branch.",
    "- Do not delete worktrees, do not merge to master, and do not switch to another branch.",
    "- Treat the context snapshots in this prompt as the complete launch context; do not resume a parent Codex conversation.",
    "- Run the narrowest meaningful self-tests before finishing.",
    "- Keep your changes scoped and production-oriented.",
    "- If you are blocked, explain the blocker clearly in the final response.",
    "",
    "Before you finish:",
    "- Leave the branch ready for the orchestrator to integrate.",
    "- Include concise notes about tests and remaining risks in the final response.",
    "",
    ...(session.launchPrompt
      ? [
        "Session launch context:",
        session.launchPrompt,
        "",
      ]
      : []),
    "Shared task memory snapshot:",
    taskMemory.trim() || "(empty)",
    "",
    "Full task markdown snapshot:",
    taskMarkdown,
  ].join("\n");
}

function buildCurrentBranchSubagentPrompt(task, taskMarkdown, taskMemory, session, sessionId, agent) {
  return [
    "You are one AgentDesk implementation subagent running in the shared current checkout.",
    "",
    `Task ID: ${task.taskId}`,
    `Session ID: ${sessionId}`,
    `Execution model: ${session.model || DEFAULT_SUBAGENT_MODEL}`,
    `Execution reasoning: ${session.reasoning || DEFAULT_SUBAGENT_REASONING}`,
    `Execution mode: ${getSessionExecutionMode(session)}`,
    `Subagent launcher: ${getSessionSubagentLauncher(session)}`,
    `Assigned subtask: ${agent.title}`,
    `Current branch: ${agent.branchName}`,
    `Project root: ${agent.worktreePath}`,
    "",
    "Context snapshot files:",
    `- Task markdown snapshot: ${agent.paths.taskSnapshotMd}`,
    `- Shared memory snapshot: ${agent.paths.memorySnapshotMd}`,
    `- Prompt snapshot: ${agent.paths.promptMd}`,
    "",
    "Rules:",
    "- Work only on the assigned subtask in the current checkout.",
    "- No separate git worktree was created because the main agent judged worktree isolation unnecessary for this session.",
    "- Do not create or switch branches, stage files, commit, rebase, merge, or delete worktrees.",
    "- Avoid files outside the assigned subtask scope, especially when other subagents may be running in the same checkout.",
    "- Do not edit .agent-desk state files; AgentDesk owns snapshots, logs, and report output.",
    "- Treat the context snapshots in this prompt as the complete launch context; do not resume a parent Codex conversation.",
    "- Run the narrowest meaningful self-tests before finishing.",
    "- Keep your changes scoped and production-oriented.",
    "- If you are blocked, explain the blocker clearly in the final response.",
    "",
    "Before you finish:",
    "- Leave current-branch changes unstaged for the main agent or caller to review.",
    "- Include concise notes about tests, changed areas, and remaining risks in the final response.",
    "",
    ...(session.launchPrompt
      ? [
        "Session launch context:",
        session.launchPrompt,
        "",
      ]
      : []),
    "Shared task memory snapshot:",
    taskMemory.trim() || "(empty)",
    "",
    "Full task markdown snapshot:",
    taskMarkdown,
  ].join("\n");
}

export function parseTaskMarkdownItems(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const checklistItems = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+\[(?: |x|X)\]\s+(.+?)\s*$/);
    if (match) {
      checklistItems.push({
        title: match[1].trim(),
        detail: "",
      });
    }
  }
  if (checklistItems.length > 0) {
    return uniqueTaskItems(checklistItems);
  }

  const subtasks = [];
  let insideSubtasks = false;
  for (const line of lines) {
    if (/^##+\s+subtasks\b/i.test(line)) {
      insideSubtasks = true;
      continue;
    }
    if (insideSubtasks && /^##+\s+/.test(line)) {
      break;
    }
    if (!insideSubtasks) {
      continue;
    }
    const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/);
    if (match) {
      subtasks.push({
        title: match[1].trim(),
        detail: "",
      });
    }
  }
  if (subtasks.length > 0) {
    return uniqueTaskItems(subtasks);
  }

  const fallback = extractMarkdownTitle(markdown) || firstSentence(markdown);
  return fallback
    ? [{ title: fallback, detail: "" }]
    : [];
}

function uniqueTaskItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.title.toLowerCase();
    if (!item.title || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function renderSessionDocument(session, task) {
  const lines = [
    `# Session ${session.sessionId}`,
    "",
    `- Task: ${task?.title || session.title || session.taskId}`,
    `- Status: ${session.status}`,
    `- Model: ${session.model || DEFAULT_SUBAGENT_MODEL}`,
    `- Reasoning: ${session.reasoning || DEFAULT_SUBAGENT_REASONING}`,
    `- Service tier: ${session.serviceTier || DEFAULT_SERVICE_TIER}`,
    `- Execution mode: ${getSessionExecutionMode(session)}`,
    `- Requested execution mode: ${session.requestedExecutionMode || session.executionMode || "-"}`,
    ...(session.worktreeDecision?.reason ? [`- Worktree decision: ${session.worktreeDecision.reason}`] : []),
    `- Subagent launcher: ${getSessionSubagentLauncher(session) || "-"}`,
    `- Parallelism: ${session.parallelism}`,
    `- Batch size: ${session.batchSize}`,
    `- Started: ${session.startedAt || "-"}`,
    `- Completed: ${session.completedAt || "-"}`,
    "",
    ...(session.launchPrompt
      ? [
        "## Launch Context",
        "",
        session.launchPrompt,
        "",
      ]
      : []),
    "## Agents",
    "",
  ];

  for (const agent of session.agents || []) {
    lines.push(`### ${agent.id} · ${agent.title}`);
    lines.push(`- Status: ${agent.status}`);
    lines.push(`- Branch: ${agent.branchName || "-"}`);
    lines.push(`- Worktree: ${agent.worktreePath || "-"}`);
    if (agent.paths?.taskSnapshotMd) {
      lines.push(`- Task snapshot: ${agent.paths.taskSnapshotMd}`);
    }
    if (agent.paths?.memorySnapshotMd) {
      lines.push(`- Memory snapshot: ${agent.paths.memorySnapshotMd}`);
    }
    if (agent.paths?.promptMd) {
      lines.push(`- Prompt snapshot: ${agent.paths.promptMd}`);
    }
    lines.push(`- Started: ${agent.startedAt || "-"}`);
    lines.push(`- Completed: ${agent.completedAt || "-"}`);
    if (Array.isArray(agent.changedFiles) && agent.changedFiles.length > 0) {
      lines.push(`- Changed files: ${agent.changedFiles.join(", ")}`);
    }
    if (Array.isArray(agent.testsRun) && agent.testsRun.length > 0) {
      lines.push(`- Tests: ${agent.testsRun.join(" | ")}`);
    }
    if (agent.summary) {
      lines.push(`- Summary: ${agent.summary}`);
    }
    if (Array.isArray(agent.risks) && agent.risks.length > 0) {
      lines.push(`- Risks: ${agent.risks.join(" | ")}`);
    }
    if (agent.lastError) {
      lines.push(`- Error: ${agent.lastError}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

async function writeSessionDocumentation(context, sessionId) {
  const session = await readSessionMeta(context, sessionId);
  const task = await readTaskMeta(context, session.taskId).catch(() => null);
  await fsp.mkdir(path.dirname(session.paths.docMd), { recursive: true });
  await fsp.writeFile(session.paths.docMd, renderSessionDocument(session, task), "utf8");
}

async function prepareAgentWorktree(context, agent) {
  await fsp.mkdir(path.dirname(agent.worktreePath), { recursive: true });
  const worktreeExists = await statSafe(agent.worktreePath);
  if (!worktreeExists) {
    const created = await spawnCapture("git", [
      "worktree",
      "add",
      "-b",
      agent.branchName,
      agent.worktreePath,
      "master",
    ], {
      cwd: context.projectRoot,
    });
    if (created.exitCode !== 0) {
      throw new Error(describeCommandFailure(created, `failed to create worktree for ${agent.id}`));
    }
  }
  const baseCommit = await gitRevParse(agent.worktreePath, "HEAD");
  return {
    worktreePath: agent.worktreePath,
    branchName: agent.branchName,
    baseCommit,
  };
}

async function finalizeAgentBranch(context, worktreePath, branchName, baseCommit, title) {
  const status = await spawnCapture("git", ["status", "--porcelain"], { cwd: worktreePath });
  if (status.exitCode !== 0) {
    throw new Error(describeCommandFailure(status, "failed to read worktree status"));
  }
  if (status.stdout.trim()) {
    const add = await spawnCapture("git", ["add", "-A"], { cwd: worktreePath });
    if (add.exitCode !== 0) {
      throw new Error(describeCommandFailure(add, "failed to stage subagent changes"));
    }
    const commit = await spawnCapture("git", ["commit", "-m", `AgentDesk: ${title}`], { cwd: worktreePath });
    if (commit.exitCode !== 0) {
      throw new Error(describeCommandFailure(commit, "failed to commit subagent changes"));
    }
  }
  const headCommit = await gitRevParse(worktreePath, "HEAD");
  const branchCount = await gitRevListCount(worktreePath, `${baseCommit}..${headCommit}`);
  return {
    branchName,
    headCommit,
    branchCount,
  };
}

async function integrateBranchIntoMaster(context, worktreePath, baseCommit, headCommit) {
  if (baseCommit === headCommit) {
    return {
      masterBefore: await gitRevParse(context.projectRoot, "master"),
      masterCommit: await gitRevParse(context.projectRoot, "master"),
      integrated: false,
      pushed: false,
    };
  }

  const lock = await acquireLock(path.join(context.locksRoot, "master-integrate.lock"));
  try {
    const upstream = await gitMasterUpstream(context.projectRoot);
    const masterBefore = await gitRevParse(context.projectRoot, "master");
    const rebase = await spawnCapture("git", ["rebase", "master"], { cwd: worktreePath });
    if (rebase.exitCode !== 0) {
      await spawnCapture("git", ["rebase", "--abort"], { cwd: worktreePath });
      throw new Error(describeCommandFailure(rebase, "failed to rebase branch onto master"));
    }
    const rebasedHead = await gitRevParse(worktreePath, "HEAD");
    const isAncestor = await gitIsAncestor(worktreePath, masterBefore, rebasedHead);
    if (!isAncestor) {
      throw new Error("rebased branch is not based on current master");
    }
    const update = await spawnCapture("git", ["update-ref", "refs/heads/master", rebasedHead, masterBefore], {
      cwd: context.projectRoot,
    });
    if (update.exitCode !== 0) {
      throw new Error(describeCommandFailure(update, "failed to advance master"));
    }
    const push = await spawnCapture("git", ["push", upstream.remoteName, `refs/heads/master:${upstream.remoteRef}`], {
      cwd: context.projectRoot,
    });
    if (push.exitCode !== 0) {
      throw new Error(describeCommandFailure(push, `failed to push master to ${upstream.displayName}`));
    }
    return {
      masterBefore,
      masterCommit: rebasedHead,
      integrated: true,
      pushed: true,
      upstream: upstream.displayName,
    };
  } finally {
    await releaseLock(lock);
  }
}

export function buildCodexExecArgs(options = {}) {
  const args = [
    "-a",
    "never",
    "exec",
    "-m",
    options.model || DEFAULT_SUBAGENT_MODEL,
    "-c",
    `model_reasoning_effort="${options.reasoning || DEFAULT_SUBAGENT_REASONING}"`,
    "-c",
    `service_tier="${options.serviceTier || DEFAULT_SERVICE_TIER}"`,
    "-s",
    options.sandboxMode || "danger-full-access",
    "-C",
    options.cwd,
    "-o",
    options.outputFile,
  ];
  if (options.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }
  if (options.outputSchemaFile) {
    args.push("--output-schema", options.outputSchemaFile);
  }
  args.push("-");
  return args;
}

async function runCodexPrompt(options) {
  const args = buildCodexExecArgs(options);
  return spawnStreamingCapture(options.context.codexCli || "codex", args, {
    cwd: options.cwd,
    stdin: options.prompt,
    stdoutLog: options.stdoutLog,
    stderrLog: options.stderrLog,
  });
}

function normalizeSubagentReport(report) {
  return {
    summary: String(report?.summary || "").trim(),
    testsRun: Array.isArray(report?.tests_run) ? report.tests_run.map(String) : [],
    risks: Array.isArray(report?.risks) ? report.risks.map(String) : [],
    notes: Array.isArray(report?.notes) ? report.notes.map(String) : [],
  };
}

async function refreshSessionCounts(context, sessionId) {
  const session = await readSessionMeta(context, sessionId);
  const counts = session.agents.reduce((accumulator, agent) => {
    accumulator.total += 1;
    if (agent.status === "succeeded") {
      accumulator.succeeded += 1;
    }
    if (agent.status === "failed") {
      accumulator.failed += 1;
    }
    if (agent.status === "running" || agent.status === "integrating") {
      accumulator.running += 1;
    }
    return accumulator;
  }, { total: 0, succeeded: 0, failed: 0, running: 0 });
  await updateSessionMeta(context, sessionId, {
    totalAgents: counts.total,
    succeededAgents: counts.succeeded,
    failedAgents: counts.failed,
    runningAgents: counts.running,
  });
}

async function patchSessionAgent(context, sessionId, agentId, patch) {
  await mutateSessionMeta(context, sessionId, (session) => {
    const agents = session.agents.map((agent) => {
      if (agent.id !== agentId) {
        return agent;
      }
      return {
        ...agent,
        ...patch,
        status: patch.status ? normalizeAgentStatus(patch.status) : agent.status,
        updatedAt: new Date().toISOString(),
      };
    });
    return {
      ...session,
      agents,
      updatedAt: new Date().toISOString(),
    };
  });
}

async function updateSessionLastError(context, sessionId, message) {
  await updateSessionMeta(context, sessionId, {
    lastError: String(message || ""),
  });
}

async function getSessionAgent(context, sessionId, agentId) {
  const session = await readSessionMeta(context, sessionId);
  return session.agents.find((agent) => agent.id === agentId) || null;
}

function resolveTaskMemoryPath(context, task) {
  const configured = normalizeOptionalString(task?.paths?.memoryMd);
  if (configured) {
    return configured;
  }
  const taskDir = normalizeOptionalString(task?.paths?.taskDir)
    || path.dirname(
      normalizeOptionalString(task?.paths?.taskMd)
        || normalizeOptionalString(task?.paths?.metaJson)
        || taskDirPath(context, task.taskId),
    );
  return path.join(taskDir, DEFAULT_TASK_MEMORY_FILENAME);
}

async function readTaskMemory(context, task) {
  return readTextSafe(resolveTaskMemoryPath(context, task));
}

function renderInitialTaskMemory(task) {
  return [
    "# Task Memory",
    "",
    `- Task: ${task.title || task.taskId}`,
    `- Task ID: ${task.taskId}`,
    `- Created: ${task.createdAt || "-"}`,
    "",
    "## Shared Context",
    "",
    "_No memory entries yet._",
    "",
  ].join("\n");
}

export async function upsertTaskMemoryEntry(context, task, sessionId, agent) {
  if (!agent) {
    return {
      memoryPath: resolveTaskMemoryPath(context, task),
      memory: await readTaskMemory(context, task),
      updated: false,
    };
  }

  const memoryPath = resolveTaskMemoryPath(context, task);
  const lock = await acquireLock(path.join(context.locksRoot, `task-memory-${task.taskId}.lock`));
  try {
    const current = await readTextSafe(memoryPath) || renderInitialTaskMemory(task);
    const markerId = `${sessionId}:${agent.id}`;
    const startMarker = `<!-- agentdesk-memory:${markerId} -->`;
    const endMarker = `<!-- /agentdesk-memory:${markerId} -->`;
    const block = `${startMarker}\n${renderTaskMemoryEntry(sessionId, agent)}\n${endMarker}`;
    const matcher = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n*`);
    const updated = matcher.test(current)
      ? current.replace(matcher, `${block}\n\n`)
      : `${current.trimEnd()}\n\n${block}\n`;
    await writeTextAtomic(memoryPath, updated);
    return { memoryPath, memory: updated, updated: true };
  } finally {
    await releaseLock(lock);
  }
}

async function persistAgentMemory(context, task, sessionId, agent, stderrLog) {
  try {
    await upsertTaskMemoryEntry(context, task, sessionId, agent);
  } catch (error) {
    appendFileSyncSafe(stderrLog, `memory update failed: ${error.message}\n`);
  }
}

function renderTaskMemoryEntry(sessionId, agent) {
  return [
    `## ${agent.id} - ${agent.title || "Untitled subtask"}`,
    "",
    `- Session: ${sessionId}`,
    `- Status: ${agent.status || "-"}`,
    `- Completed: ${agent.completedAt || "-"}`,
    `- Summary: ${agent.summary || "-"}`,
    `- Changed files: ${formatMemoryList(agent.changedFiles)}`,
    `- Tests: ${formatMemoryList(agent.testsRun)}`,
    `- Risks: ${formatMemoryList(agent.risks)}`,
    `- Notes: ${formatMemoryList(agent.notes)}`,
    `- Error: ${agent.lastError || "-"}`,
  ].join("\n");
}

function formatMemoryList(items) {
  return Array.isArray(items) && items.length > 0
    ? items.map((item) => String(item).trim()).filter(Boolean).join(" | ") || "-"
    : "-";
}

async function readTaskMeta(context, taskId) {
  return readJsonRequired(path.join(taskDirPath(context, taskId), "meta.json"));
}

async function readSessionMeta(context, sessionId) {
  return readJsonRequired(path.join(sessionDirPath(context, sessionId), "meta.json"));
}

async function updateTaskMeta(context, taskId, patch) {
  return mutateTaskMeta(context, taskId, (meta) => {
    const status = patch.status ? normalizeTaskStatus(patch.status) : meta.status;
    return {
      ...meta,
      ...patch,
      status,
      updatedAt: new Date().toISOString(),
    };
  });
}

async function updateTaskActiveSessionStatus(context, taskId, sessionId, activeSessionStatus) {
  return mutateTaskMeta(context, taskId, (meta) => {
    if (meta.activeSessionId && meta.activeSessionId !== sessionId) {
      return meta;
    }
    return {
      ...meta,
      status: "running",
      activeSessionId: sessionId,
      activeSessionStatus,
      updatedAt: new Date().toISOString(),
    };
  });
}

async function finishTaskActiveSession(context, taskId, sessionId, patch) {
  return mutateTaskMeta(context, taskId, (meta) => {
    if (meta.activeSessionId && meta.activeSessionId !== sessionId) {
      return meta;
    }
    const status = patch.status ? normalizeTaskStatus(patch.status) : meta.status;
    return {
      ...meta,
      ...patch,
      status,
      activeSessionId: "",
      activeSessionStartedAt: null,
      activeSessionStatus: "",
      updatedAt: new Date().toISOString(),
    };
  });
}

async function updateSessionMeta(context, sessionId, patch) {
  return mutateSessionMeta(context, sessionId, (meta) => {
    const status = patch.status ? normalizeSessionStatus(patch.status) : meta.status;
    return {
      ...meta,
      ...patch,
      status,
      updatedAt: new Date().toISOString(),
    };
  });
}

function normalizeTaskStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!TASK_STATUSES.has(normalized)) {
    throw new Error(`unsupported task status: ${status}`);
  }
  return normalized;
}

function normalizeSessionStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!SESSION_STATUSES.has(normalized)) {
    throw new Error(`unsupported session status: ${status}`);
  }
  return normalized;
}

function normalizeAgentStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!AGENT_STATUSES.has(normalized)) {
    throw new Error(`unsupported agent status: ${status}`);
  }
  return normalized;
}

async function mutateTaskMeta(context, taskId, mutate) {
  const metaPath = path.join(taskDirPath(context, taskId), "meta.json");
  const lock = await acquireLock(path.join(context.locksRoot, `task-${taskId}.lock`));
  try {
    const meta = await readJsonRequired(metaPath);
    const updated = mutate(meta);
    await writeJsonAtomic(metaPath, updated);
    return updated;
  } finally {
    await releaseLock(lock);
  }
}

async function mutateSessionMeta(context, sessionId, mutate) {
  const metaPath = path.join(sessionDirPath(context, sessionId), "meta.json");
  const lock = await acquireLock(path.join(context.locksRoot, `session-${sessionId}.lock`));
  try {
    const meta = await readJsonRequired(metaPath);
    const updated = mutate(meta);
    await writeJsonAtomic(metaPath, updated);
    return updated;
  } finally {
    await releaseLock(lock);
  }
}

async function allocateTaskDir(context, request) {
  const base = `task-${compactTimestamp(new Date())}-${slug(request.title)}`;
  const { id, dir } = await allocateUniqueDir(base, (candidate) => taskDirPath(context, candidate));
  return { taskId: id, taskDir: dir };
}

async function allocateSessionDir(context, task) {
  const base = `session-${compactTimestamp(new Date())}-${slug(task.title || task.taskId)}`;
  const { id, dir } = await allocateUniqueDir(base, (candidate) => sessionDirPath(context, candidate));
  return { sessionId: id, sessionDir: dir };
}

async function allocateUniqueDir(base, toDirPath) {
  let candidate = base;
  let suffix = 2;
  while (true) {
    const dir = toDirPath(candidate);
    try {
      await fsp.mkdir(path.dirname(dir), { recursive: true });
      await fsp.mkdir(dir, { recursive: false });
      return { id: candidate, dir };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
  }
}

function taskDirPath(context, taskId) {
  return path.join(context.tasksRoot, taskId);
}

function sessionDirPath(context, sessionId) {
  return path.join(context.sessionsRoot, sessionId);
}

async function assertGitRepository(projectRoot) {
  const result = await spawnCapture("git", ["rev-parse", "--show-toplevel"], { cwd: projectRoot });
  if (result.exitCode !== 0) {
    throw new Error("selected project is not a git repository");
  }
}

async function assertMasterBranch(projectRoot) {
  const result = await spawnCapture("git", ["rev-parse", "--verify", "master"], { cwd: projectRoot });
  if (result.exitCode !== 0) {
    throw new Error("selected project does not have a master branch");
  }
}

async function assertExecutable(filePath, label) {
  try {
    await fsp.access(filePath, fs.constants.X_OK);
  } catch {
    throw new Error(`${label} is not executable: ${filePath}`);
  }
}

async function gitRevParse(cwd, ref) {
  const result = await spawnCapture("git", ["rev-parse", ref], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(describeCommandFailure(result, `git rev-parse ${ref} failed`));
  }
  return result.stdout.trim();
}

async function gitRevListCount(cwd, range) {
  const result = await spawnCapture("git", ["rev-list", "--count", range], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(describeCommandFailure(result, "git rev-list failed"));
  }
  return Number(result.stdout.trim() || "0");
}

async function gitCurrentBranch(cwd) {
  const result = await spawnCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(describeCommandFailure(result, "git current branch lookup failed"));
  }
  return result.stdout.trim() || "current-branch";
}

async function gitIsAncestor(cwd, ancestor, descendant) {
  const result = await spawnCapture("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd });
  return result.exitCode === 0;
}

async function gitMasterUpstream(cwd) {
  const result = await spawnCapture("git", [
    "for-each-ref",
    "--format=%(upstream:remotename)%09%(upstream:remoteref)",
    "refs/heads/master",
  ], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(describeCommandFailure(result, "failed to read master upstream"));
  }
  const [remoteName, remoteRef] = result.stdout.trim().split("\t");
  if (!remoteName || !remoteRef) {
    throw new Error("master branch does not have an upstream; configure master to track a remote before worktree integration can push");
  }
  return {
    remoteName,
    remoteRef,
    displayName: `${remoteName}/${remoteRef.replace(/^refs\/heads\//, "")}`,
  };
}

async function listBranchFiles(cwd, baseCommit) {
  const result = await spawnCapture("git", ["diff", "--name-only", `${baseCommit}..HEAD`], { cwd });
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function listCurrentBranchChangedFiles(cwd) {
  const [tracked, untracked] = await Promise.all([
    spawnCapture("git", ["diff", "--name-only", "HEAD"], { cwd }),
    spawnCapture("git", ["ls-files", "--others", "--exclude-standard"], { cwd }),
  ]);
  return uniqueSorted([
    ...(tracked.exitCode === 0 ? tracked.stdout.split(/\r?\n/) : []),
    ...(untracked.exitCode === 0 ? untracked.stdout.split(/\r?\n/) : []),
  ].map((line) => line.trim()).filter((file) => file && !file.startsWith(`${AGENT_DESK_STATE_DIRNAME}/`)));
}

function diffChangedFiles(before, after) {
  const beforeSet = new Set(before || []);
  const added = (after || []).filter((file) => !beforeSet.has(file));
  return added.length > 0 ? uniqueSorted(added) : uniqueSorted(after || []);
}

async function acquireLock(lockPath) {
  const started = Date.now();
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });
  while (true) {
    try {
      await fsp.mkdir(lockPath, { recursive: false });
      const markerPath = path.join(lockPath, "owner.json");
      await fsp.writeFile(markerPath, JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }, null, 2), "utf8");
      return { lockPath };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - started > 30 * 60 * 1000) {
        throw new Error(`timed out waiting for lock: ${lockPath}`);
      }
      await sleep(500);
    }
  }
}

async function releaseLock(lock) {
  if (!lock?.lockPath) {
    return;
  }
  await fsp.rm(lock.lockPath, { recursive: true, force: true });
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

async function spawnStreamingCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      appendFileSyncSafe(options.stdoutLog, text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      appendFileSyncSafe(options.stderrLog, text);
    });
    child.on("error", (error) => {
      resolve({ exitCode: 1, signal: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode: exitCode ?? 1, signal, stdout, stderr });
    });
    if (options.stdin) {
      child.stdin.end(`${options.stdin}\n`);
    } else {
      child.stdin.end();
    }
  });
}

function appendFileSyncSafe(filePath, content) {
  if (!filePath || !content) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, content, "utf8");
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

async function writeTextAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, value, "utf8");
  await fsp.rename(tmpPath, filePath);
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

function normalizeOptionalString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function similarityScore(left, right) {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }
  if (
    normalizedLeft.length >= 12
    && normalizedRight.length >= 12
    && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return 0.92;
  }
  return Math.max(
    jaccardScore(comparableTokens(normalizedLeft), comparableTokens(normalizedRight)),
    diceScore(characterBigrams(normalizedLeft), characterBigrams(normalizedRight)),
  );
}

function normalizeComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function comparableTokens(value) {
  return new Set(String(value || "").split(/\s+/).filter(Boolean));
}

function characterBigrams(value) {
  const characters = [...String(value || "").replace(/\s+/g, "")];
  if (characters.length === 0) {
    return new Set();
  }
  if (characters.length < 3) {
    return new Set([characters.join("")]);
  }
  const grams = new Set();
  for (let index = 0; index < characters.length - 1; index += 1) {
    grams.add(characters.slice(index, index + 2).join(""));
  }
  return grams;
}

function jaccardScore(left, right) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }
  return intersection / new Set([...left, ...right]).size;
}

function diceScore(left, right) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }
  return (2 * intersection) / (left.size + right.size);
}

function definedObject(object) {
  return Object.fromEntries(
    Object.entries(object || {}).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function normalizeBoolean(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const text = String(value).trim().toLowerCase();
  if (BOOLEAN_TRUE_VALUES.has(text)) {
    return true;
  }
  if (BOOLEAN_FALSE_VALUES.has(text)) {
    return false;
  }
  throw new Error(`${fieldName} must be a boolean`);
}

function stripTomlComment(line) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && inDoubleQuote) {
      escaped = true;
      continue;
    }
    if (character === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (character === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (character === "#" && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlValue(raw, lineNumber) {
  if (/^".*"$/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`invalid TOML string on line ${lineNumber}`);
    }
  }
  if (/^'.*'$/.test(raw)) {
    return raw.slice(1, -1);
  }
  if (/^(true|false)$/i.test(raw)) {
    return raw.toLowerCase() === "true";
  }
  if (/^[+-]?\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  if (/^[+-]?\d+\.\d+$/.test(raw)) {
    return Number.parseFloat(raw);
  }
  throw new Error(`unsupported TOML value on line ${lineNumber}`);
}

function tomlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function firstNonEmptyLine(text) {
  return String(text || "").split(/\r?\n/).find((line) => line.trim())?.trim() || "";
}

function extractMarkdownTitle(markdown) {
  const match = String(markdown || "").match(/^#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : "";
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function slug(value) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || "item";
}

function shortHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function firstSentence(text) {
  const line = String(text || "").split(/\r?\n/).find((entry) => entry.trim()) || "";
  return line.trim().slice(0, 96) || "Task";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function describeCommandFailure(result, fallback) {
  const details = [String(result?.stderr || "").trim(), String(result?.stdout || "").trim()]
    .filter(Boolean)
    .join("\n");
  return details || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
