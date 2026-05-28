import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { z } from "zod/v4";
import {
  createContext,
  createSession,
  createTask,
  getCodexAppLaunchPlan,
  getHealth,
  getSession,
  getTask,
  listSessions,
  listTasks,
  parseTaskMarkdownItems,
  snapshotStateStamp,
} from "./control-plane.mjs";
import { createOverallTaskApiStore } from "./overall-tasks.mjs";
import { claimTaskMarkdownItems } from "./task-files.mjs";

export const DEFAULT_TASK_API_BASE_PATH = "/api/agentdesk";
export const DEFAULT_TASK_API_HOST = "127.0.0.1";
export const DEFAULT_TASK_API_PORT = 19731;
export const TASK_API_STORE_METHODS = Object.freeze([
  "listTasks",
  "getTask",
  "createTask",
  "updateTask",
  "claimTask",
  "dispatchTask",
  "getStatus",
  "getTaskStatus",
  "listAudit",
  "getSessionSummary",
]);

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const MAX_JSON_BODY_BYTES = 1_000_000;
const TASK_STATUS_VALUES = [
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
];
const SESSION_STATUSES = ["queued", "waiting_for_app", "running", "succeeded", "failed"];
const ROUTES = Object.freeze([
  { method: "GET", path: "/health", description: "Overall local AgentDesk API and project status." },
  { method: "GET", path: "/tasks", description: "List day/week/month overall task summaries." },
  { method: "POST", path: "/tasks", description: "Create an overall task through the SQLite task store." },
  { method: "GET", path: "/tasks/:taskId", description: "Read an overall task detail." },
  { method: "PATCH", path: "/tasks/:taskId", description: "Update overall task metadata." },
  { method: "POST", path: "/tasks/:taskId/claim", description: "Claim an overall task." },
  { method: "POST", path: "/tasks/:taskId/dispatch", description: "Record dispatch/session state for an overall task." },
  { method: "GET", path: "/tasks/:taskId/status", description: "Read compact task execution status." },
  { method: "GET", path: "/tasks/:taskId/audit", description: "Read local audit events for a task." },
  { method: "GET", path: "/tasks/:taskId/sessions/summary", description: "Summarize task sessions for the UI." },
  { method: "GET", path: "/sessions/recent", description: "List recent AgentDesk sessions for the UI." },
]);

const TaskIdParamSchema = z.object({
  taskId: z.string().trim().min(1),
});
const ListTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUS_VALUES).optional(),
  q: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  range: z.enum(["day", "week", "month"]).optional(),
  period: z.enum(["day", "week", "month"]).optional(),
  periodType: z.enum(["day", "week", "month"]).optional(),
  periodKey: z.string().trim().min(1).optional(),
  assignee: z.string().trim().min(1).optional(),
  projectRoot: z.string().optional(),
}).passthrough();
const RecentSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(6),
});
const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const CreateTaskRequestSchema = z.object({
  title: z.string().trim().min(1),
  brief: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  priority: z.union([z.string(), z.number()]).optional(),
  taskType: z.string().optional(),
  periodType: z.enum(["day", "week", "month"]).optional(),
  periodKey: z.string().optional(),
  projectRoot: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).passthrough();
const UpdateTaskRequestSchema = z.object({
  title: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  brief: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  priority: z.union([z.string(), z.number()]).optional(),
  taskType: z.string().optional(),
  periodType: z.enum(["day", "week", "month"]).optional(),
  periodKey: z.string().optional(),
  projectRoot: z.string().optional(),
  markdown: z.string().optional(),
  memory: z.string().optional(),
}).passthrough().refine((value) => Object.keys(value).length > 0, {
  message: "at least one update field is required",
});
const ClaimTaskRequestSchema = z.object({
  items: z.array(z.union([z.number().int().positive(), z.string().trim().min(1)])).optional(),
  assignee: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1).optional(),
  note: z.string().trim().min(1).optional(),
  force: z.boolean().optional(),
}).passthrough();
const DispatchTaskRequestSchema = z.object({
  parallelism: z.number().int().positive().optional(),
  parallel: z.number().int().positive().optional(),
  model: z.string().trim().min(1).optional(),
  reasoning: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  serviceTier: z.literal("fast").optional(),
  launchBatchSize: z.literal(6).optional(),
  executionMode: z.enum(["auto", "worktree", "current-branch"]).optional(),
  subagentLauncher: z.enum(["codex-cli", "codex-app"]).optional(),
  baseBranch: z.string().trim().min(1).optional(),
  base_branch: z.string().trim().min(1).optional(),
  worktreeIntegration: z.enum(["agent-branch", "fast-forward"]).optional(),
  worktree_integration: z.enum(["agent-branch", "fast-forward"]).optional(),
  pushWorktreeIntegration: z.boolean().optional(),
  push_worktree_integration: z.boolean().optional(),
  launchPrompt: z.string().optional(),
  waitForCompletion: z.boolean().optional(),
  allowDuplicateSession: z.boolean().optional(),
  force: z.boolean().optional(),
}).passthrough();

const PassthroughObjectSchema = z.object({}).passthrough();
const RouteInfoSchema = z.object({
  method: z.string(),
  path: z.string(),
  description: z.string(),
});
const ApiInfoSchema = z.object({
  name: z.literal("agent-desk-task-api"),
  version: z.string(),
  basePath: z.string(),
  projectRoot: z.string().optional(),
  taskStoreDbPath: z.string().optional(),
  routes: z.array(RouteInfoSchema),
  viteProxy: z.object({
    path: z.string(),
    target: z.string(),
  }),
  staticServing: z.object({
    enabled: z.boolean(),
    directory: z.string(),
  }),
});
const TaskSummarySchema = z.object({
  taskId: z.string(),
}).passthrough();
const TaskListResponseSchema = z.object({
  items: z.array(TaskSummarySchema),
}).passthrough();
const StatusResponseSchema = z.object({
  ok: z.boolean().optional(),
}).passthrough();
const AuditEventSchema = z.object({
  id: z.number().optional(),
  taskId: z.string(),
  eventType: z.string(),
  actor: z.string().optional(),
  createdAt: z.string(),
}).passthrough();
const AuditResponseSchema = z.object({
  items: z.array(AuditEventSchema),
}).passthrough();
const SessionSummaryResponseSchema = z.object({
  taskId: z.string(),
  counts: z.object({}).passthrough(),
  items: z.array(PassthroughObjectSchema),
}).passthrough();

export class TaskApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "TaskApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createTaskApiServer(options = {}) {
  const basePath = normalizeBasePath(options.basePath || DEFAULT_TASK_API_BASE_PATH);
  const store = options.store;
  if (!store || typeof store !== "object") {
    throw new Error("task API store is required");
  }
  const staticDir = options.staticDir ? path.resolve(String(options.staticDir)) : "";
  const projectRoot = options.projectRoot ? path.resolve(String(options.projectRoot)) : "";

  return http.createServer((request, response) => {
    void handleRequest(request, response, {
      basePath,
      store,
      staticDir,
      projectRoot,
    }).catch((error) => {
      writeError(response, error);
    });
  });
}

export async function startTaskApiServer(options = {}) {
  const host = String(options.host || process.env.AGENT_DESK_TASK_API_HOST || DEFAULT_TASK_API_HOST);
  const port = normalizePort(options.port ?? process.env.AGENT_DESK_TASK_API_PORT ?? DEFAULT_TASK_API_PORT);
  const context = options.context || createContext(options);
  const store = options.store || await createOverallTaskApiStore({
    ...options,
    context,
  });
  const server = createTaskApiServer({
    ...options,
    store,
    projectRoot: context.projectRoot,
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  const basePath = normalizeBasePath(options.basePath || DEFAULT_TASK_API_BASE_PATH);
  return {
    server,
    host,
    port: resolvedPort,
    basePath,
    url: `http://${host}:${resolvedPort}${basePath}`,
    close: async () => {
      await closeServer(server);
      await store.close?.();
    },
  };
}

export async function createTaskApiStore(options = {}) {
  return createOverallTaskApiStore(options);
}

export async function createControlPlaneTaskApiStore(options = {}) {
  const context = options.context || createContext(options);
  const core = {
    getHealth,
    listTasks,
    getTask,
    createTask,
    createSession,
    getSession,
    listSessions,
    getCodexAppLaunchPlan,
    snapshotStateStamp,
    ...options.core,
  };
  const auditStore = options.auditStore === false
    ? createNoopAuditStore()
    : options.auditStore || await createSqliteAuditBridge({
      sqlitePath: options.sqlitePath || path.join(context.deskRoot, "task-api.sqlite"),
    });

  return {
    context,
    async getStatus() {
      const health = await core.getHealth(context);
      return {
        ...health,
        stateStamp: await core.snapshotStateStamp(context).catch(() => ""),
      };
    },
    async listTasks(query = {}) {
      return filterTaskList(await core.listTasks(context), query);
    },
    async getTask(taskId) {
      return core.getTask(context, taskId);
    },
    async createTask(request) {
      const result = await core.createTask(context, request);
      await auditStore.record({
        taskId: auditTaskId(result),
        eventType: "task.create",
        actor: "",
        request,
        result: summarizeAuditResult(result),
      });
      return result;
    },
    async updateTask(taskId, patch) {
      const result = typeof core.updateTask === "function"
        ? await core.updateTask(context, taskId, patch)
        : await updateControlPlaneTask(context, core, taskId, patch);
      await auditStore.record({
        taskId,
        eventType: "task.update",
        actor: "",
        request: patch,
        result: summarizeAuditResult(result),
      });
      return result;
    },
    async claimTask(taskId, request) {
      const result = typeof core.claimTask === "function"
        ? await core.claimTask(context, taskId, request)
        : await claimControlPlaneTask(context, core, taskId, request);
      await auditStore.record({
        taskId,
        eventType: "task.claim",
        actor: request.assignee || "",
        request,
        result: summarizeAuditResult(result),
      });
      return result;
    },
    async dispatchTask(taskId, request) {
      const result = typeof core.dispatchTask === "function"
        ? await core.dispatchTask(context, taskId, request)
        : await dispatchControlPlaneTask(context, core, taskId, request);
      await auditStore.record({
        taskId,
        eventType: "task.dispatch",
        actor: "",
        request,
        result: summarizeAuditResult(result),
      });
      return result;
    },
    async getTaskStatus(taskId) {
      return typeof core.getTaskStatus === "function"
        ? core.getTaskStatus(context, taskId)
        : getControlPlaneTaskStatus(context, core, taskId);
    },
    async listAudit(taskId, query = {}) {
      return auditStore.list({ taskId, limit: query.limit });
    },
    async getSessionSummary(taskId) {
      return typeof core.getSessionSummary === "function"
        ? core.getSessionSummary(context, taskId)
        : getControlPlaneSessionSummary(context, core, taskId);
    },
    async close() {
      await auditStore.close?.();
    },
  };
}

export async function createSqliteAuditBridge(options = {}) {
  const rawSqlitePath = String(options.sqlitePath || options.filePath || "").trim();
  if (!rawSqlitePath) {
    throw new Error("sqlitePath is required");
  }
  const sqlitePath = path.resolve(rawSqlitePath);
  await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(sqlitePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS task_api_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT '',
      request_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_api_audit_task_created
      ON task_api_audit_events(task_id, created_at DESC, id DESC);
  `);

  const insert = db.prepare(`
    INSERT INTO task_api_audit_events
      (task_id, event_type, actor, request_json, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectByTask = db.prepare(`
    SELECT id, task_id, event_type, actor, request_json, result_json, created_at
    FROM task_api_audit_events
    WHERE task_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);

  return {
    async record(event = {}) {
      const createdAt = event.createdAt || new Date().toISOString();
      insert.run(
        String(event.taskId || ""),
        String(event.eventType || "task.event"),
        String(event.actor || ""),
        safeJsonStringify(event.request || {}),
        safeJsonStringify(event.result || {}),
        createdAt,
      );
      return { createdAt };
    },
    async list(query = {}) {
      const taskId = String(query.taskId || "");
      const limit = clampNumber(query.limit, 50, 1, 200);
      const rows = selectByTask.all(taskId, limit);
      return {
        items: rows.map((row) => ({
          id: Number(row.id),
          taskId: row.task_id,
          eventType: row.event_type,
          actor: row.actor,
          request: parseJsonObject(row.request_json),
          result: parseJsonObject(row.result_json),
          createdAt: row.created_at,
        })),
      };
    },
    async close() {
      db.close();
    },
  };
}

async function handleRequest(request, response, options) {
  setCommonHeaders(response, request);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = requestUrl(request);
  const pathname = normalizePathname(url.pathname);
  if (isApiRoot(pathname, options.basePath)) {
    return sendSuccess(response, 200, apiInfo(options, request), ApiInfoSchema);
  }
  if (!pathname.startsWith(`${options.basePath}/`)) {
    if (options.staticDir && await serveStatic(request, response, options.staticDir, pathname)) {
      return;
    }
    if (pathname === "/") {
      return sendSuccess(response, 200, apiInfo(options, request), ApiInfoSchema);
    }
    throw new TaskApiError(404, "NOT_FOUND", `route not found: ${pathname}`);
  }

  const segments = pathname.slice(options.basePath.length).split("/").filter(Boolean);
  if (segments.length === 1 && segments[0] === "health" && request.method === "GET") {
    const result = await callStore(options.store, "getStatus");
    return sendSuccess(response, 200, result, StatusResponseSchema);
  }
  if (segments.length === 1 && segments[0] === "tasks" && request.method === "GET") {
    const query = parseWithSchema(ListTasksQuerySchema, queryObject(url), "query");
    const result = await callStore(options.store, "listTasks", query);
    return sendSuccess(response, 200, result, TaskListResponseSchema);
  }
  if (segments.length === 1 && segments[0] === "tasks" && request.method === "POST") {
    const body = parseWithSchema(CreateTaskRequestSchema, await readJsonBody(request), "body");
    const result = await callStore(options.store, "createTask", body);
    return sendSuccess(response, 201, result, PassthroughObjectSchema);
  }

  // 导入本地项目中的已有任务（.agent-desk/tasks 或 task/ 下的 markdown）
  if (segments.length === 1 && segments[0] === "import-project" && request.method === "POST") {
    const body = await readJsonBody(request);
    const projectPath = String(body?.projectPath || body?.path || "").trim();
    if (!projectPath) {
      throw new TaskApiError(400, "BAD_REQUEST", "projectPath is required");
    }
    const result = await callStore(options.store, "importProjectTasks", projectPath);
    return sendSuccess(response, 200, result, PassthroughObjectSchema);
  }
  if (segments.length === 2 && segments[0] === "sessions" && segments[1] === "recent" && request.method === "GET") {
    const query = parseWithSchema(RecentSessionsQuerySchema, queryObject(url), "query");
    const result = await callStore(options.store, "listRecentSessions", query.limit);
    return sendSuccess(response, 200, result, z.array(PassthroughObjectSchema));
  }
  if (segments[0] !== "tasks" || segments.length < 2) {
    throw new TaskApiError(404, "NOT_FOUND", `route not found: ${pathname}`);
  }

  const { taskId } = parseWithSchema(TaskIdParamSchema, { taskId: segments[1] }, "params");
  if (segments.length === 2 && request.method === "GET") {
    const result = await callStore(options.store, "getTask", taskId);
    return sendSuccess(response, 200, result, PassthroughObjectSchema);
  }
  if (segments.length === 2 && request.method === "PATCH") {
    const body = parseWithSchema(UpdateTaskRequestSchema, await readJsonBody(request), "body");
    const result = await callStore(options.store, "updateTask", taskId, body);
    return sendSuccess(response, 200, result, PassthroughObjectSchema);
  }
  if (segments.length === 3 && segments[2] === "claim" && request.method === "POST") {
    const body = parseWithSchema(ClaimTaskRequestSchema, await readJsonBody(request), "body");
    const result = await callStore(options.store, "claimTask", taskId, body);
    return sendSuccess(response, 200, result, PassthroughObjectSchema);
  }
  if (segments.length === 3 && segments[2] === "dispatch" && request.method === "POST") {
    const body = parseWithSchema(DispatchTaskRequestSchema, await readJsonBody(request), "body");
    const result = await callStore(options.store, "dispatchTask", taskId, body);
    return sendSuccess(response, 202, result, PassthroughObjectSchema);
  }
  if (segments.length === 3 && segments[2] === "status" && request.method === "GET") {
    const result = await callStore(options.store, "getTaskStatus", taskId);
    return sendSuccess(response, 200, result, StatusResponseSchema);
  }
  if (segments.length === 3 && segments[2] === "audit" && request.method === "GET") {
    const query = parseWithSchema(AuditQuerySchema, queryObject(url), "query");
    const result = await callStore(options.store, "listAudit", taskId, query);
    return sendSuccess(response, 200, result, AuditResponseSchema);
  }
  if (
    segments.length === 4
    && segments[2] === "sessions"
    && segments[3] === "summary"
    && request.method === "GET"
  ) {
    const result = await callStore(options.store, "getSessionSummary", taskId);
    return sendSuccess(response, 200, result, SessionSummaryResponseSchema);
  }

  throw new TaskApiError(404, "NOT_FOUND", `route not found: ${pathname}`);
}

async function callStore(store, method, ...args) {
  if (typeof store[method] !== "function") {
    throw new TaskApiError(501, "STORE_METHOD_UNAVAILABLE", `task API store does not implement ${method}`);
  }
  return store[method](...args);
}

function parseWithSchema(schema, value, fieldName) {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw new TaskApiError(400, "VALIDATION_ERROR", `invalid ${fieldName}`, result.error.issues);
}

function sendSuccess(response, status, data, dataSchema) {
  const envelopeSchema = z.object({
    ok: z.literal(true),
    data: dataSchema,
  });
  const envelope = envelopeSchema.parse({ ok: true, data });
  writeJson(response, status, envelope);
}

function writeError(response, error) {
  const normalized = normalizeError(error);
  writeJson(response, normalized.status, {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details }),
    },
  });
}

function normalizeError(error) {
  if (error instanceof TaskApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof SyntaxError) {
    return {
      status: 400,
      code: "INVALID_JSON",
      message: error.message,
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: error?.message || String(error || "internal server error"),
  };
}

function writeJson(response, status, payload) {
  if (response.headersSent || response.writableEnded) {
    return;
  }
  response.writeHead(status, { "content-type": JSON_CONTENT_TYPE });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new TaskApiError(413, "PAYLOAD_TOO_LARGE", "JSON request body is too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

function requestUrl(request) {
  const host = request.headers.host || "127.0.0.1";
  return new URL(request.url || "/", `http://${host}`);
}

function queryObject(url) {
  const result = {};
  for (const [key, value] of url.searchParams.entries()) {
    result[key] = value;
  }
  return result;
}

function normalizeBasePath(value) {
  const text = String(value || DEFAULT_TASK_API_BASE_PATH).trim();
  const withSlash = text.startsWith("/") ? text : `/${text}`;
  return normalizePathname(withSlash).replace(/\/+$/g, "") || DEFAULT_TASK_API_BASE_PATH;
}

function normalizePathname(value) {
  const text = decodeURIComponent(String(value || "/"));
  return text.startsWith("/") ? text : `/${text}`;
}

function isApiRoot(pathname, basePath) {
  return pathname === basePath || pathname === `${basePath}/`;
}

function apiInfo(options, request) {
  const target = request
    ? `http://${request.headers.host || "127.0.0.1"}`
    : "";
  return {
    name: "agent-desk-task-api",
    version: "0.1.0",
    basePath: options.basePath,
    projectRoot: options.projectRoot || options.store?.context?.projectRoot || "",
    taskStoreDbPath: options.store?.context?.taskStoreDbPath || "",
    routes: ROUTES.map((route) => ({
      ...route,
      path: `${options.basePath}${route.path}`,
    })),
    viteProxy: {
      path: options.basePath,
      target,
    },
    staticServing: {
      enabled: Boolean(options.staticDir),
      directory: options.staticDir || "",
    },
  };
}

async function serveStatic(request, response, staticDir, pathname) {
  if (!["GET", "HEAD"].includes(request.method || "")) {
    return false;
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(staticDir, relative);
  if (!isInsidePath(candidate, staticDir)) {
    throw new TaskApiError(403, "STATIC_PATH_FORBIDDEN", "static path must stay inside staticDir");
  }
  let filePath = candidate;
  let stat = await fs.stat(filePath).catch(() => null);
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    stat = await fs.stat(filePath).catch(() => null);
  }
  if (!stat?.isFile()) {
    const fallback = path.join(staticDir, "index.html");
    const fallbackStat = await fs.stat(fallback).catch(() => null);
    if (!fallbackStat?.isFile()) {
      return false;
    }
    filePath = fallback;
  }
  response.writeHead(200, {
    "content-type": contentTypeForPath(filePath),
  });
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  response.end(await fs.readFile(filePath));
  return true;
}

async function updateControlPlaneTask(context, core, taskId, patch) {
  const task = await core.getTask(context, taskId);
  const metaPath = task.paths?.metaJson || path.join(context.tasksRoot, taskId, "meta.json");
  const meta = await readJsonRequired(metaPath);
  const now = new Date().toISOString();
  const updated = {
    ...meta,
    updatedAt: now,
  };
  if (patch.title !== undefined) {
    updated.title = patch.title;
    updated.name = patch.title;
  }
  if (patch.name !== undefined) {
    updated.name = patch.name;
  }
  if (patch.brief !== undefined) {
    updated.brief = patch.brief;
    if (updated.paths?.briefMd) {
      await writeTextAtomic(updated.paths.briefMd, patch.brief);
    }
  }
  if (patch.status !== undefined) {
    updated.status = patch.status;
    if (["succeeded", "failed"].includes(patch.status) && !updated.completedAt) {
      updated.completedAt = now;
    }
    if (!["succeeded", "failed"].includes(patch.status)) {
      updated.completedAt = null;
    }
  }
  if (patch.markdown !== undefined) {
    await writeTextAtomic(updated.paths?.taskMd || path.join(path.dirname(metaPath), "task.md"), patch.markdown);
    updated.subtaskCount = parseTaskMarkdownItems(patch.markdown).length;
  }
  if (patch.memory !== undefined) {
    const memoryPath = updated.paths?.memoryMd || path.join(path.dirname(metaPath), "memory.md");
    await writeTextAtomic(memoryPath, patch.memory);
  }
  await writeJsonAtomic(metaPath, updated);
  return core.getTask(context, taskId);
}

async function claimControlPlaneTask(context, core, taskId, request) {
  const taskDir = path.relative(context.deskRoot, path.join(context.tasksRoot, taskId));
  const claim = await claimTaskMarkdownItems({
    projectRoot: context.deskRoot,
    taskDir,
    taskName: "task.md",
    items: request.items,
    assignee: request.assignee,
    sessionId: request.sessionId,
    note: request.note,
    force: request.force,
  });
  return {
    task: await core.getTask(context, taskId),
    claim,
  };
}

async function dispatchControlPlaneTask(context, core, taskId, request) {
  const session = await core.createSession(context, taskId, {
    ...request,
    waitForCompletion: request.waitForCompletion ?? false,
    allowDuplicateSession: request.allowDuplicateSession || request.force,
  });
  const appLaunchPlan = session.sessionId
    ? await core.getCodexAppLaunchPlan(context, session.sessionId).catch(() => null)
    : null;
  return {
    ...session,
    waitedForCompletion: request.waitForCompletion ?? false,
    requiresHostLaunch: Boolean(appLaunchPlan?.requiresHostLaunch),
    ...(appLaunchPlan ? { appLaunchPlan } : {}),
  };
}

async function getControlPlaneTaskStatus(context, core, taskId) {
  const task = await core.getTask(context, taskId);
  return {
    taskId: task.taskId,
    name: task.name || task.title || task.taskId,
    status: task.status,
    activeSessionId: task.activeSessionId || "",
    activeSessionStatus: task.activeSessionStatus || "",
    subtaskCount: task.subtaskCount || 0,
    sessionCount: task.sessionCount || task.sessions?.length || 0,
    latestSessionId: task.latestSessionId || task.sessions?.[0]?.sessionId || "",
    latestSessionStatus: task.latestSessionStatus || task.sessions?.[0]?.status || "",
    updatedAt: task.updatedAt || "",
    completedAt: task.completedAt || null,
  };
}

async function getControlPlaneSessionSummary(context, core, taskId) {
  const result = await core.listSessions(context, { taskId });
  const counts = countByStatus(result.items || [], SESSION_STATUSES);
  return {
    taskId,
    counts: {
      total: (result.items || []).length,
      ...counts,
    },
    items: result.items || [],
  };
}

function filterTaskList(result, query = {}) {
  const q = String(query.q || "").trim().toLowerCase();
  const status = String(query.status || "").trim();
  const items = (result.items || []).filter((item) => {
    if (status && item.status !== status) {
      return false;
    }
    if (!q) {
      return true;
    }
    return [
      item.taskId,
      item.name,
      item.title,
      item.brief,
      item.status,
    ].some((value) => String(value || "").toLowerCase().includes(q));
  });
  return {
    ...result,
    items,
  };
}

function countByStatus(items, statuses) {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const item of items) {
    if (Object.hasOwn(counts, item.status)) {
      counts[item.status] += 1;
    }
  }
  return counts;
}

function auditTaskId(result) {
  return String(result?.taskId || result?.task?.taskId || result?.data?.taskId || "");
}

function summarizeAuditResult(result) {
  if (!result || typeof result !== "object") {
    return {};
  }
  return {
    taskId: result.taskId || result.task?.taskId || "",
    sessionId: result.sessionId || result.session?.sessionId || "",
    status: result.status || result.task?.status || "",
    requiresConfirmation: Boolean(result.requiresConfirmation),
    reusedExistingTask: Boolean(result.reusedExistingTask),
  };
}

function createNoopAuditStore() {
  return {
    async record() {
      return {};
    },
    async list() {
      return { items: [] };
    },
    async close() {},
  };
}

function contentTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") {
    return "text/html; charset=utf-8";
  }
  if (ext === ".css") {
    return "text/css; charset=utf-8";
  }
  if (ext === ".js" || ext === ".mjs") {
    return "text/javascript; charset=utf-8";
  }
  if (ext === ".json") {
    return JSON_CONTENT_TYPE;
  }
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

function setCommonHeaders(response, request) {
  const origin = String(request.headers.origin || "");
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/u.test(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }
  response.setHeader("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("port must be an integer between 0 and 65535");
  }
  return port;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function safeJsonStringify(value) {
  const text = JSON.stringify(value ?? {});
  if (text.length <= 20_000) {
    return text;
  }
  return JSON.stringify({
    truncated: true,
    length: text.length,
  });
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function readJsonRequired(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

async function writeTextAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, String(value), "utf8");
  await fs.rename(tmpPath, filePath);
}

function isInsidePath(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
