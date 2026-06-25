import fs from "node:fs";
import path from "node:path";
import { z } from "zod/v4";
import {
  createContext,
  createSession,
  generateSubtaskBreakdown,
  listSessions,
  materializeControlPlaneTask,
  parseMarkdownChecklist,
  parseTaskMarkdownItems,
  DEFAULT_PARALLELISM,
  DEFAULT_LAUNCH_BATCH_SIZE,
} from "./control-plane.mjs";
import { execFileSync } from "node:child_process";
import { canonicalizeTaskPeriodKey, validateTaskPeriod } from "./task-periods.mjs";
import { validateTaskProjectRoot } from "./task-validation.mjs";
import { backfillTaskMarkdownSources, openTaskStore } from "./task-store.mjs";

const OVERALL_TASK_STATUSES = Object.freeze([
  "draft",
  "backlog",
  "ready",
  "claimed",
  "dispatched",
  "running",
  "blocked",
  "done",
  "succeeded",
  "failed",
  "canceled",
]);
const PRIORITY_VALUES = Object.freeze(["low", "normal", "high", "urgent"]);
const PRIORITY_TO_NUMBER = Object.freeze({ low: 10, normal: 50, high: 80, urgent: 100 });
const NUMBER_TO_PRIORITY = Object.freeze([
  [90, "urgent"],
  [70, "high"],
  [20, "normal"],
  [0, "low"],
]);

const createOverallTaskSchema = z.object({
  id: z.string().trim().min(1).optional(),
  overallTaskId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  brief: z.string().optional(),
  taskType: z.string().trim().min(1).optional(),
  periodType: z.enum(["day", "week", "month"]).optional(),
  period: z.enum(["day", "week", "month"]).optional(),
  periodKey: z.string().trim().optional(),
  date: z.string().trim().optional(),
  status: z.string().trim().optional(),
  priority: z.union([z.string(), z.number()]).optional(),
  assignee: z.string().optional(),
  owner: z.string().optional(),
  projectRoot: z.string().optional(),
  branch: z.string().optional(),
  dueAt: z.string().nullable().optional(),
  actor: z.string().optional(),
  sessionId: z.string().optional(),
}).passthrough();

const updateOverallTaskSchema = createOverallTaskSchema
  .omit({ id: true, overallTaskId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one update field is required");

const claimOverallTaskSchema = z.object({
  assignee: z.string().optional(),
  owner: z.string().optional(),
  claimedBy: z.string().optional(),
  sessionId: z.string().optional(),
  session: z.string().optional(),
  actor: z.string().optional(),
  note: z.string().optional(),
  force: z.boolean().optional(),
}).passthrough();

const dispatchOverallTaskSchema = z.object({
  assignee: z.string().optional(),
  owner: z.string().optional(),
  sessionId: z.string().optional(),
  session: z.string().optional(),
  actor: z.string().optional(),
  branch: z.string().optional(),
  target: z.string().optional(),
  dispatchTarget: z.string().optional(),
  agentdeskTaskId: z.string().optional(),
  taskId: z.string().optional(),
  note: z.string().optional(),
  force: z.boolean().optional(),
  // Real-execution params (web UI Dispatch panel). Presence triggers the control-plane bridge.
  parallel: z.number().int().positive().optional(),
  parallelism: z.number().int().positive().optional(),
  launchBatchSize: z.number().int().positive().optional(),
  model: z.string().optional(),
  reasoning: z.string().optional(),
  serviceTier: z.string().optional(),
  executionMode: z.string().optional(),
  subagentLauncher: z.string().optional(),
  baseBranch: z.string().optional(),
  base_branch: z.string().optional(),
}).passthrough();

const breakdownOverallTaskSchema = z.object({
  model: z.string().optional(),
  reasoning: z.string().optional(),
  serviceTier: z.string().optional(),
}).passthrough();

export async function breakdownOverallTask(contextLike, overallTaskId, request = {}) {
  const context = normalizeContext(contextLike);
  const parsed = breakdownOverallTaskSchema.parse(request);
  return withOverallTaskStore(context, async (store) => {
    const before = requireTask(store, overallTaskId);
    if (!before.projectRoot) {
      throw new Error("subtask breakdown requires a project-bound task (projectRoot)");
    }
    const projectContext = createContext({ projectRoot: before.projectRoot });
    const existingMarkdown = loadSourceMarkdown(before.sourcePath) || before.markdown || "";
    const { markdown } = await generateSubtaskBreakdown(projectContext, {
      title: before.title,
      brief: before.description,
      existingMarkdown,
      model: parsed.model,
      reasoning: parsed.reasoning,
      serviceTier: parsed.serviceTier,
    });
    const subtasks = parseMarkdownChecklist(markdown).map((item) => ({
      title: item.title,
      checked: Boolean(item.checked),
      ...(item.parallel ? { parallel: item.parallel } : {}),
    }));
    return { ok: true, taskId: overallTaskId, markdown, subtasks };
  });
}

export function serializeAgentDeskError(error) {
  return {
    code: error?.code || "AGENT_DESK_ERROR",
    message: error?.message || String(error),
    details: error?.details || {},
  };
}

export async function createOverallTask(contextLike, request = {}) {
  const context = normalizeContext(contextLike);
  const parsed = createOverallTaskSchema.parse(request);
  await validateProjectRootForTask(context, parsed);
  return withOverallTaskStore(context, async (store) => {
    const task = store.createTask(normalizeStoreTaskInput(context, parsed), {
      actor: parsed.actor || parsed.assignee || parsed.owner,
      sessionId: parsed.sessionId,
      message: parsed.note,
    });
    return { ok: true, task: toOverallTask(store, task) };
  });
}

export async function listOverallTasks(contextLike, filters = {}) {
  const context = normalizeContext(contextLike);
  return withOverallTaskStore(context, async (store) => {
    await maybeBackfill(store, context, filters);
    const periodType = normalizeOptionalString(filters.periodType || filters.period);
    const periodKey = normalizeOptionalString(filters.periodKey || (periodType ? periodKeyFromRequest(periodType, filters) : ""));
    const status = normalizeOptionalString(filters.status);
    const assignee = normalizeOptionalString(filters.assignee || filters.owner);
    const query = normalizeOptionalString(filters.q || filters.query).toLowerCase();
    const hasProjectRootFilter = filters.projectRoot !== undefined;
    const projectRoot = hasProjectRootFilter ? normalizeProjectRootForStore(filters.projectRoot) : "";
    const items = store.listTasks({
      ...(hasProjectRootFilter ? { projectRoot, includeUserTasks: Boolean(projectRoot) } : {}),
      ...(periodType ? { periodType } : {}),
      ...(periodKey ? { periodKey } : {}),
      ...(status && status !== "all" ? { status: mapUiStatusToStore(status) } : {}),
      ...(assignee ? { assignee } : {}),
      limit: filters.limit || 500,
    }).filter((task) => {
      if (!query) {
        return true;
      }
      return [task.id, task.title, task.description, task.status, task.assignee]
        .some((value) => String(value || "").toLowerCase().includes(query));
    }).map((task) => toOverallTask(store, task));
    return {
      ok: true,
      period: periodType,
      periodKey,
      items,
      summary: summarizeOverallTasks(items),
    };
  });
}

export async function getOverallTask(contextLike, overallTaskId) {
  const context = normalizeContext(contextLike);
  return withOverallTaskStore(context, async (store) => {
    const task = requireTask(store, overallTaskId);
    const sessions = await recentSessionsForTask(context, task.id);
    return { ok: true, task: toOverallTask(store, task, { recentSessions: sessions }) };
  });
}

export async function updateOverallTask(contextLike, overallTaskId, patch = {}) {
  const context = normalizeContext(contextLike);
  const parsed = updateOverallTaskSchema.parse(patch);
  return withOverallTaskStore(context, async (store) => {
    const before = requireTask(store, overallTaskId);
    await validateProjectRootForTask(context, parsed, before);
    const task = store.updateTask(overallTaskId, normalizeStoreTaskPatch(parsed), {
      actor: parsed.actor || parsed.assignee || parsed.owner,
      sessionId: parsed.sessionId,
      message: parsed.note,
    });
    return { ok: true, task: toOverallTask(store, task) };
  });
}

export async function claimOverallTask(contextLike, overallTaskId, request = {}) {
  const context = normalizeContext(contextLike);
  const parsed = claimOverallTaskSchema.parse(request);
  const assignee = requiredText(parsed.assignee || parsed.owner || parsed.claimedBy, "assignee");
  return withOverallTaskStore(context, async (store) => {
    const task = store.claimTask(overallTaskId, {
      assignee,
      sessionId: parsed.sessionId || parsed.session || "",
      actor: parsed.actor || assignee,
      message: parsed.note,
      force: Boolean(parsed.force),
    });
    return { ok: true, task: toOverallTask(store, task) };
  });
}

export async function dispatchOverallTask(contextLike, overallTaskId, request = {}) {
  const context = normalizeContext(contextLike);
  const parsed = dispatchOverallTaskSchema.parse(request);
  const requestedSessionId = requiredText(parsed.sessionId || parsed.session, "sessionId");
  return withOverallTaskStore(context, async (store) => {
    const before = requireTask(store, overallTaskId);
    if (before.taskType === "coding" && !before.projectRoot) {
      throw new Error("coding overall task requires projectRoot before dispatch");
    }

    // Bridge to real codex execution when this is a project-bound coding task, the request
    // carries execution params (the web UI always sends parallel/model), and the project is a
    // git repository (the control-plane session runner creates a git worktree per subagent).
    // Otherwise fall back to recording dispatch state only (legacy behavior).
    let realSessionId = "";
    let executed = false;
    let executionNote = "";
    const wantsExecution = hasExecutionParams(parsed);
    if (before.taskType === "coding" && before.projectRoot && wantsExecution) {
      if (!isGitRepository(before.projectRoot)) {
        executionNote = `projectRoot is not a git repository; recorded dispatch only: ${before.projectRoot}`;
      } else {
        try {
          const projectContext = createContext({ projectRoot: before.projectRoot });
          const markdown = loadSourceMarkdown(before.sourcePath)
            || `# ${before.title}\n\n## Subtasks\n\n- [ ] ${before.title}\n`;
          await materializeControlPlaneTask(projectContext, {
            taskId: overallTaskId,
            title: before.title,
            brief: before.description,
            markdown,
          });
          const session = await createSession(projectContext, overallTaskId, {
            parallelism: resolveDispatchParallelism(parsed),
            launchBatchSize: parsed.launchBatchSize || DEFAULT_LAUNCH_BATCH_SIZE,
            model: parsed.model,
            reasoning: parsed.reasoning,
            serviceTier: parsed.serviceTier,
            executionMode: parsed.executionMode,
            subagentLauncher: parsed.subagentLauncher,
            baseBranch: parsed.baseBranch || parsed.base_branch || parsed.branch,
            waitForCompletion: false,
            allowDuplicateSession: Boolean(parsed.force),
          });
          realSessionId = session.sessionId || "";
          executed = Boolean(realSessionId);
        } catch (error) {
          // Surface a clear, recoverable message instead of a generic 500; still record dispatch.
          executionNote = `codex execution failed to start, recorded dispatch only: ${error.message}`;
        }
      }
    }

    const task = store.dispatchTask(overallTaskId, {
      assignee: parsed.assignee || parsed.owner || before.assignee,
      sessionId: realSessionId || requestedSessionId,
      actor: parsed.actor || parsed.assignee || parsed.owner,
      branch: parsed.branch,
      target: parsed.dispatchTarget || parsed.target,
      agentdeskTaskId: parsed.agentdeskTaskId || parsed.taskId || (executed ? overallTaskId : undefined),
      message: parsed.note,
      force: Boolean(parsed.force),
    });
    return { ok: true, task: toOverallTask(store, task), executed, ...(executionNote ? { note: executionNote } : {}) };
  });
}

function hasExecutionParams(request = {}) {
  return request.parallel !== undefined
    || request.parallelism !== undefined
    || request.model !== undefined
    || request.reasoning !== undefined
    || request.launchBatchSize !== undefined;
}

function resolveDispatchParallelism(request = {}) {
  const value = request.parallelism ?? request.parallel ?? DEFAULT_PARALLELISM;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PARALLELISM;
}

function isGitRepository(projectRoot) {
  if (!projectRoot) return false;
  try {
    execFileSync("git", ["-C", projectRoot, "rev-parse", "--is-inside-work-tree"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function normalizeContext(contextLike, options = {}) {
  return normalizeOverallContext(contextLike, options);
}

function normalizeOverallContext(contextLike, options = {}) {
  const context = contextLike?.tasksRoot ? contextLike : createContext(contextLike || options || {});
  const taskStoreDbPath = normalizeOptionalString(
    options.taskStoreDbPath || options.sqlitePath || options.dbPath || context.taskStoreDbPath,
  );
  const taskStoreDeskRoot = normalizeOptionalString(
    options.taskStoreDeskRoot || options.overallDeskRoot || context.taskStoreDeskRoot || context.deskRoot,
  );
  return {
    ...context,
    taskStoreDbPath,
    taskStoreDeskRoot,
  };
}

async function withOverallTaskStore(context, callback) {
  // 注意：这里打开的永远是用户根目录级别的全局 Overall Tasks SQLite
  // （见 task-store.mjs 中的设计原则说明）。单个项目不拥有自己的这个数据库。
  const store = openTaskStore({
    projectRoot: context.projectRoot,
    deskRoot: context.taskStoreDeskRoot,
    dbPath: context.taskStoreDbPath,
  });
  try {
    return await callback(store);
  } finally {
    store.close();
  }
}

async function maybeBackfill(store, context, filters) {
  if (filters.backfill === false || filters.skipBackfill) {
    return;
  }
  const projectRoot = filters.projectRoot !== undefined
    ? normalizeProjectRootForStore(filters.projectRoot)
    : context.projectRoot;
  if (!projectRoot) {
    return;
  }
  await backfillTaskMarkdownSources(store, {
    projectRoot,
    deskRoot: projectRoot === context.projectRoot ? context.deskRoot : path.join(projectRoot, ".agent-desk"),
  });
}

async function validateProjectRootForTask(context, input, existingTask = null) {
  const taskType = input.taskType !== undefined
    ? input.taskType || "general"
    : existingTask?.taskType || "general";
  const projectRoot = input.projectRoot !== undefined
    ? normalizeProjectRootForStore(input.projectRoot)
    : existingTask
      ? existingTask.projectRoot
      : taskType === "coding"
        ? context.projectRoot
        : "";
  await validateTaskProjectRoot({
    taskType,
    projectRoot,
  }, {
    checkExists: false,
  });
}

function normalizeStoreTaskInput(context, input) {
  const periodType = normalizePeriodType(input.periodType || input.period || "day");
  const periodKey = periodKeyFromRequest(periodType, input);
  const taskType = input.taskType || "general";
  return {
    id: input.id || input.overallTaskId,
    title: input.title,
    description: input.description ?? input.brief ?? "",
    taskType,
    periodType,
    periodKey,
    status: mapUiStatusToStore(input.status || "ready"),
    priority: normalizePriority(input.priority),
    assignee: input.assignee || input.owner || "",
    projectRoot: effectiveTaskProjectRoot(context, input, taskType),
    branch: input.branch || "",
    sourceType: "overall-task",
    dueAt: input.dueAt || null,
  };
}

function normalizeStoreTaskPatch(input) {
  const patch = {};
  if (input.title !== undefined) {
    patch.title = input.title;
  }
  if (input.description !== undefined || input.brief !== undefined) {
    patch.description = input.description ?? input.brief ?? "";
  }
  if (input.taskType !== undefined) {
    patch.taskType = input.taskType || "general";
  }
  if (input.periodType !== undefined || input.period !== undefined) {
    patch.periodType = normalizePeriodType(input.periodType || input.period);
  }
  if (input.periodKey !== undefined || input.date !== undefined) {
    const periodType = patch.periodType || input.periodType || input.period || "day";
    patch.periodKey = periodKeyFromRequest(periodType, input);
  }
  if (input.status !== undefined) {
    patch.status = mapUiStatusToStore(input.status);
  }
  if (input.priority !== undefined) {
    patch.priority = normalizePriority(input.priority);
  }
  if (input.assignee !== undefined || input.owner !== undefined) {
    patch.assignee = input.assignee || input.owner || "";
  }
  if (input.projectRoot !== undefined) {
    patch.projectRoot = normalizeProjectRootForStore(input.projectRoot);
  }
  if (input.branch !== undefined) {
    patch.branch = input.branch || "";
  }
  if (input.dueAt !== undefined) {
    patch.dueAt = input.dueAt || null;
  }
  return patch;
}

function toOverallTask(store, task, options = {}) {
  const audit = store.getAuditEvents(task.id);
  const latestClaim = latestAuditEvent(audit, "claim");
  const latestDispatch = latestAuditEvent(audit, "dispatch");
  const dispatchMetadata = latestDispatch?.changes?.dispatchMetadata || {};
  return {
    ...task,
    overallTaskId: task.id,
    taskId: task.id,
    scope: task.projectRoot ? "project" : "user",
    isProjectBound: Boolean(task.projectRoot),
    brief: task.description,
    period: task.periodType,
    owner: task.assignee,
    claim: {
      claimedBy: task.claimedBy,
      claimedAt: task.claimedAt,
      sessionId: task.claimSessionId,
      note: latestClaim?.message || "",
    },
    dispatch: {
      status: task.dispatchSessionId ? "dispatched" : "not_dispatched",
      sessionId: task.dispatchSessionId,
      dispatchedAt: task.dispatchedAt,
      dispatchedBy: latestDispatch?.actor || "",
      target: dispatchMetadata.target || "",
      agentdeskTaskId: dispatchMetadata.agentdeskTaskId || "",
      note: latestDispatch?.message || "",
    },
    session: {
      sessionId: task.dispatchSessionId || task.claimSessionId || "",
      status: task.dispatchSessionId ? "dispatched" : "not_started",
      updatedAt: task.dispatchedAt || task.claimedAt || task.updatedAt,
    },
    markdown: "",
    memory: "",
    tags: [],
    priorityLabel: priorityLabel(task.priority),
    recentSessions: options.recentSessions || [],
    audit: audit.map((event) => ({
      action: event.eventType,
      at: event.createdAt,
      actor: event.actor,
      sessionId: event.sessionId,
      message: event.message,
      changes: event.changes,
    })),
  };
}

function latestAuditEvent(events, eventType) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].eventType === eventType) {
      return events[index];
    }
  }
  return null;
}

function loadSourceMarkdown(sourcePath) {
  if (!sourcePath) return "";
  try {
    return fs.readFileSync(sourcePath, "utf8");
  } catch {
    return "";
  }
}

function toUiSessionSummary(session) {
  return {
    sessionId: session.sessionId,
    taskId: session.taskId,
    taskTitle: session.taskTitle || session.taskName || session.name || session.taskId,
    status: session.status,
    startedAt: session.startedAt || session.createdAt || session.updatedAt || "",
    finishedAt: session.completedAt || "",
    model: session.model || "gpt-5.5",
    reasoning: session.reasoning || "xhigh",
    serviceTier: session.serviceTier || "fast",
    parallel: session.parallelism || 0,
    launchBatchSize: session.batchSize || 6,
    agents: {
      total: session.totalAgents || 0,
      running: session.runningAgents || 0,
      succeeded: session.succeededAgents || 0,
      failed: session.failedAgents || 0,
    },
    lastError: session.lastError || "",
  };
}

async function recentSessionsForTask(context, taskId) {
  const result = await listSessions(context, { taskId }).catch(() => ({ items: [] }));
  return result.items.map(toUiSessionSummary);
}

function summarizeOverallTasks(items) {
  return {
    total: items.length,
    ready: items.filter((task) => task.status === "ready").length,
    running: items.filter((task) => task.status === "running" || task.status === "dispatched").length,
    blocked: items.filter((task) => task.status === "blocked").length,
    succeeded: items.filter((task) => task.status === "succeeded" || task.status === "done").length,
  };
}

function normalizePeriodType(value) {
  return validateTaskPeriod({
    periodType: value || "day",
    periodKey: periodKeyFromRequest(value || "day", {}),
  }).periodType;
}

function periodKeyFromRequest(periodTypeValue, input = {}) {
  const periodType = String(periodTypeValue || "day");
  if (input.periodKey) {
    return canonicalizeTaskPeriodKey(periodType, input.periodKey);
  }
  const date = input.date ? new Date(input.date) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid date: ${input.date}`);
  }
  if (periodType === "day") {
    return formatDate(date);
  }
  if (periodType === "month") {
    return formatDate(date).slice(0, 7);
  }
  return isoWeekKey(date);
}

function isoWeekKey(date) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((current - yearStart) / 86400000) + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function formatDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function normalizePriority(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(999, Math.round(value)));
  }
  const text = normalizeOptionalString(value || "normal").toLowerCase();
  return PRIORITY_TO_NUMBER[text] ?? PRIORITY_TO_NUMBER.normal;
}

function effectiveTaskProjectRoot(context, input, taskType) {
  if (input.projectRoot !== undefined) {
    return normalizeProjectRootForStore(input.projectRoot);
  }
  return taskType === "coding" ? context.projectRoot : "";
}

function normalizeProjectRootForStore(value) {
  const text = normalizeOptionalString(value);
  return text ? path.resolve(text) : "";
}

function priorityLabel(value) {
  const numeric = Number(value || 0);
  return NUMBER_TO_PRIORITY.find(([minimum]) => numeric >= minimum)?.[1] || "normal";
}

function mapUiStatusToStore(status) {
  const value = normalizeOptionalString(status || "ready").toLowerCase();
  if (value === "succeeded") {
    return "succeeded";
  }
  if (value === "draft") {
    return "draft";
  }
  if (!OVERALL_TASK_STATUSES.includes(value)) {
    throw new Error(`unsupported overall task status: ${status}`);
  }
  return value;
}

function requireTask(store, taskId) {
  const task = store.getTask(requiredText(taskId, "overallTaskId"));
  if (!task) {
    throw new Error(`overall task not found: ${taskId}`);
  }
  return task;
}

function requiredText(value, label) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw new Error(`${label} is required`);
  }
  return text;
}

function normalizeOptionalString(value) {
  return String(value ?? "").trim();
}
