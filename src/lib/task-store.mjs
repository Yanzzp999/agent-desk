import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod/v4";
import { canonicalizeTaskPeriodKey } from "./task-periods.mjs";

export const TASK_STORE_SCHEMA_VERSION = 1;
export const AGENT_DESK_STATE_DIRNAME = ".agent-desk";
export const DEFAULT_TASK_STORE_DB_FILENAME = "tasks.sqlite";
export const TASK_STORE_MEMORY_PATH = ":memory:";
export const TASK_STATUS_VALUES = Object.freeze([
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
export const PERIOD_TYPE_VALUES = Object.freeze([
  "none",
  "day",
  "week",
  "month",
]);
export const TASK_AUDIT_EVENT_TYPES = Object.freeze([
  "create",
  "register",
  "backfill",
  "update",
  "claim",
  "dispatch",
  "status_change",
]);

const TASK_STATUS_SET = new Set(TASK_STATUS_VALUES);
const PERIOD_TYPE_SET = new Set(PERIOD_TYPE_VALUES);
const TASK_AUDIT_EVENT_TYPE_SET = new Set(TASK_AUDIT_EVENT_TYPES);
const DEFAULT_TASK_TYPE = "general";
const DEFAULT_TASK_STATUS = "backlog";
const DEFAULT_PERIOD_TYPE = "none";
const DEFAULT_SOURCE_TYPE = "manual";
const MARKDOWN_SOURCE_TYPE_AGENT_DESK = "agent-desk-task-md";
const MARKDOWN_SOURCE_TYPE_PROJECT_TASK = "project-task-md";
const MAX_ID_LENGTH = 140;
const MAX_TASK_TYPE_LENGTH = 80;
const MAX_BRANCH_LENGTH = 260;
const MAX_ASSIGNEE_LENGTH = 160;
const MAX_SESSION_ID_LENGTH = 220;
const MAX_SOURCE_TYPE_LENGTH = 80;
const MAX_PERIOD_KEY_LENGTH = 120;
const MAX_DISPATCH_TARGET_LENGTH = 220;

const optionalText = z.preprocess((value) => normalizeOptionalString(value), z.string());
const nonEmptyText = z.preprocess((value) => normalizeOptionalString(value), z.string().min(1));
const nullableDateTime = z.preprocess((value) => {
  const text = normalizeOptionalString(value);
  return text || null;
}, z.union([z.string().refine(isValidDateString, "must be a valid date"), z.null()]));

const managedTaskCreateSchema = z.object({
  id: optionalText.optional(),
  title: nonEmptyText,
  description: optionalText.optional(),
  taskType: optionalText.optional(),
  periodType: optionalText.optional(),
  periodKey: optionalText.optional(),
  status: optionalText.optional(),
  priority: z.coerce.number().int().min(0).max(999).optional(),
  assignee: optionalText.optional(),
  claimedBy: optionalText.optional(),
  claimSessionId: optionalText.optional(),
  claimedAt: nullableDateTime.optional(),
  dispatchSessionId: optionalText.optional(),
  dispatchedAt: nullableDateTime.optional(),
  projectRoot: optionalText.optional(),
  branch: optionalText.optional(),
  sourceType: optionalText.optional(),
  sourcePath: optionalText.optional(),
  sourceFingerprint: optionalText.optional(),
  createdAt: nullableDateTime.optional(),
  updatedAt: nullableDateTime.optional(),
  dueAt: nullableDateTime.optional(),
}).strict();

const managedTaskPatchSchema = managedTaskCreateSchema
  .omit({ id: true, createdAt: true })
  .partial()
  .strict();

const claimTaskSchema = z.object({
  assignee: nonEmptyText,
  sessionId: optionalText.optional(),
  actor: optionalText.optional(),
  message: optionalText.optional(),
  force: z.boolean().optional(),
  now: nullableDateTime.optional(),
}).strict();

const dispatchTaskSchema = z.object({
  sessionId: nonEmptyText,
  assignee: optionalText.optional(),
  actor: optionalText.optional(),
  branch: optionalText.optional(),
  target: optionalText.optional(),
  agentdeskTaskId: optionalText.optional(),
  message: optionalText.optional(),
  force: z.boolean().optional(),
  now: nullableDateTime.optional(),
}).strict();

const statusChangeSchema = z.object({
  status: nonEmptyText,
  actor: optionalText.optional(),
  sessionId: optionalText.optional(),
  now: nullableDateTime.optional(),
  message: optionalText.optional(),
}).strict();

const auditEventSchema = z.object({
  taskId: nonEmptyText,
  eventType: nonEmptyText,
  actor: optionalText.optional(),
  sessionId: optionalText.optional(),
  message: optionalText.optional(),
  changes: z.record(z.string(), z.unknown()).optional(),
  createdAt: nullableDateTime.optional(),
}).strict();

export function resolveTaskStoreDbPath(options = {}) {
  if (
    options.dbPath === TASK_STORE_MEMORY_PATH
    || options.path === TASK_STORE_MEMORY_PATH
    || options.sqlitePath === TASK_STORE_MEMORY_PATH
    || options.taskStoreDbPath === TASK_STORE_MEMORY_PATH
  ) {
    return TASK_STORE_MEMORY_PATH;
  }
  const explicitPath = normalizeOptionalString(options.dbPath || options.path || options.sqlitePath || options.taskStoreDbPath);
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  const deskRoot = path.resolve(options.deskRoot || options.taskStoreDeskRoot || resolveUserAgentDeskRoot(options));
  return path.join(deskRoot, DEFAULT_TASK_STORE_DB_FILENAME);
}

export function resolveUserAgentDeskRoot(options = {}) {
  return path.resolve(options.homeDir || os.homedir(), AGENT_DESK_STATE_DIRNAME);
}

export function openTaskStore(options = {}) {
  const dbPath = resolveTaskStoreDbPath(options);
  if (dbPath !== TASK_STORE_MEMORY_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  const store = new TaskStore(db, {
    ...options,
    dbPath,
    projectRoot: resolveProjectRoot(options.projectRoot),
  });
  store.migrate();
  return store;
}

export function migrateTaskStoreDatabase(db) {
  db.exec("PRAGMA foreign_keys = ON");
  const version = readUserVersion(db);
  if (version > TASK_STORE_SCHEMA_VERSION) {
    throw new Error(`unsupported task store schema version ${version}; expected <= ${TASK_STORE_SCHEMA_VERSION}`);
  }
  if (version < 1) {
    runImmediateTransaction(db, () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_desk_store_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS managed_tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          task_type TEXT NOT NULL DEFAULT '${DEFAULT_TASK_TYPE}',
          period_type TEXT NOT NULL DEFAULT '${DEFAULT_PERIOD_TYPE}',
          period_key TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '${DEFAULT_TASK_STATUS}',
          priority INTEGER NOT NULL DEFAULT 0,
          assignee TEXT NOT NULL DEFAULT '',
          claimed_by TEXT NOT NULL DEFAULT '',
          claim_session_id TEXT NOT NULL DEFAULT '',
          claimed_at TEXT,
          dispatch_session_id TEXT NOT NULL DEFAULT '',
          dispatched_at TEXT,
          project_root TEXT NOT NULL DEFAULT '',
          branch TEXT NOT NULL DEFAULT '',
          source_type TEXT NOT NULL DEFAULT '${DEFAULT_SOURCE_TYPE}',
          source_path TEXT NOT NULL DEFAULT '',
          source_fingerprint TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          due_at TEXT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS managed_tasks_source_path_unique
          ON managed_tasks(source_path)
          WHERE source_path <> '';
        CREATE INDEX IF NOT EXISTS managed_tasks_project_status_idx
          ON managed_tasks(project_root, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS managed_tasks_period_idx
          ON managed_tasks(period_type, period_key, updated_at DESC);
        CREATE INDEX IF NOT EXISTS managed_tasks_assignee_idx
          ON managed_tasks(assignee, updated_at DESC);

        CREATE TABLE IF NOT EXISTS managed_task_audit_events (
          event_id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          actor TEXT NOT NULL DEFAULT '',
          session_id TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          changes_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          FOREIGN KEY (task_id) REFERENCES managed_tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS managed_task_audit_task_idx
          ON managed_task_audit_events(task_id, event_id);
        CREATE INDEX IF NOT EXISTS managed_task_audit_type_idx
          ON managed_task_audit_events(event_type, created_at DESC);
      `);
      setMetaValue(db, "schema_version", String(TASK_STORE_SCHEMA_VERSION));
      db.exec(`PRAGMA user_version = ${TASK_STORE_SCHEMA_VERSION}`);
    });
  }
}

export class TaskStore {
  constructor(db, options = {}) {
    this.db = db;
    this.dbPath = options.dbPath || "";
    this.projectRoot = resolveProjectRoot(options.projectRoot);
    this.now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  }

  migrate() {
    migrateTaskStoreDatabase(this.db);
  }

  close() {
    this.db.close();
  }

  getSchemaVersion() {
    return readUserVersion(this.db);
  }

  createTask(input = {}, options = {}) {
    const now = normalizeDateString(options.now || input.createdAt || this.now());
    const normalized = normalizeTaskForInsert(input, { now, projectRoot: this.projectRoot });
    return runImmediateTransaction(this.db, () => {
      this.db.prepare(`
        INSERT INTO managed_tasks (
          id, title, description, task_type, period_type, period_key, status, priority,
          assignee, claimed_by, claim_session_id, claimed_at, dispatch_session_id, dispatched_at,
          project_root, branch, source_type, source_path, source_fingerprint, created_at, updated_at, due_at
        ) VALUES (
          :id, :title, :description, :taskType, :periodType, :periodKey, :status, :priority,
          :assignee, :claimedBy, :claimSessionId, :claimedAt, :dispatchSessionId, :dispatchedAt,
          :projectRoot, :branch, :sourceType, :sourcePath, :sourceFingerprint, :createdAt, :updatedAt, :dueAt
        )
      `).run(normalized);
      this.appendAuditEvent({
        taskId: normalized.id,
        eventType: options.eventType || "create",
        actor: options.actor || normalized.assignee,
        sessionId: options.sessionId || normalized.claimSessionId || normalized.dispatchSessionId,
        createdAt: now,
        message: options.message || "",
        changes: { after: normalized },
      });
      return this.getTask(normalized.id);
    });
  }

  upsertTask(input = {}, options = {}) {
    const now = normalizeDateString(options.now || input.updatedAt || this.now());
    const normalized = normalizeTaskForInsert(input, {
      now,
      projectRoot: this.projectRoot,
      preserveCreatedAt: true,
    });
    const existing = normalized.sourcePath
      ? this.getTaskBySourcePath(normalized.sourcePath)
      : this.getTask(normalized.id);
    if (!existing) {
      return this.createTask({
        ...normalized,
        createdAt: normalized.createdAt || now,
        updatedAt: now,
      }, {
        eventType: options.eventType || "create",
        actor: options.actor,
        sessionId: options.sessionId,
        message: options.message,
        now,
      });
    }
    const patch = {
      title: normalized.title,
      description: normalized.description,
      taskType: normalized.taskType,
      periodType: normalized.periodType,
      periodKey: normalized.periodKey,
      status: normalized.status,
      priority: normalized.priority,
      assignee: normalized.assignee,
      claimedBy: normalized.claimedBy,
      claimSessionId: normalized.claimSessionId,
      claimedAt: normalized.claimedAt,
      dispatchSessionId: normalized.dispatchSessionId,
      dispatchedAt: normalized.dispatchedAt,
      projectRoot: normalized.projectRoot,
      branch: normalized.branch,
      sourceType: normalized.sourceType,
      sourcePath: normalized.sourcePath,
      sourceFingerprint: normalized.sourceFingerprint,
      dueAt: normalized.dueAt,
    };
    return this.updateTask(existing.id, patch, {
      eventType: options.eventType || "update",
      actor: options.actor,
      sessionId: options.sessionId,
      message: options.message,
      now,
    });
  }

  getTask(id) {
    const taskId = requiredText(id, "task id");
    const row = this.db.prepare("SELECT * FROM managed_tasks WHERE id = ?").get(taskId);
    return row ? rowToTask(row) : null;
  }

  getTaskBySourcePath(sourcePath) {
    const normalizedSourcePath = normalizeSourcePath(sourcePath);
    if (!normalizedSourcePath) {
      return null;
    }
    const row = this.db.prepare("SELECT * FROM managed_tasks WHERE source_path = ?").get(normalizedSourcePath);
    return row ? rowToTask(row) : null;
  }

  listTasks(filters = {}) {
    const where = [];
    const params = {};
    if (Object.hasOwn(filters, "projectRoot")) {
      const projectRoot = normalizeProjectRootForStorage(filters.projectRoot);
      if (projectRoot) {
        params.projectRoot = projectRoot;
        where.push(filters.includeUserTasks
          ? "(project_root = :projectRoot OR project_root = '')"
          : "project_root = :projectRoot");
      } else {
        where.push("project_root = ''");
      }
    }
    if (filters.status) {
      const statuses = [].concat(filters.status).map((status) => normalizeStatus(status));
      params.statuses = statuses;
      where.push(`status IN (${statuses.map((_, index) => `:status${index}`).join(", ")})`);
      statuses.forEach((status, index) => {
        params[`status${index}`] = status;
      });
      delete params.statuses;
    }
    if (filters.periodType) {
      params.periodType = normalizePeriodType(filters.periodType);
      where.push("period_type = :periodType");
    }
    if (filters.periodKey !== undefined) {
      params.periodKey = normalizeBoundedText(filters.periodKey, "periodKey", MAX_PERIOD_KEY_LENGTH);
      where.push("period_key = :periodKey");
    }
    if (filters.assignee) {
      params.assignee = normalizeBoundedText(filters.assignee, "assignee", MAX_ASSIGNEE_LENGTH);
      where.push("assignee = :assignee");
    }
    const limit = clampInteger(filters.limit, 200, 1, 1000);
    const offset = clampInteger(filters.offset, 0, 0, 1_000_000);
    params.limit = limit;
    params.offset = offset;
    const sql = `
      SELECT * FROM managed_tasks
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC, created_at DESC, id ASC
      LIMIT :limit OFFSET :offset
    `;
    return this.db.prepare(sql).all(params).map(rowToTask);
  }

  updateTask(id, patch = {}, options = {}) {
    const taskId = requiredText(id, "task id");
    const now = normalizeDateString(options.now || patch.updatedAt || this.now());
    const parsedPatch = managedTaskPatchSchema.parse(patch);
    const normalizedPatch = normalizeTaskPatch(parsedPatch);
    return runImmediateTransaction(this.db, () => {
      const before = this.getTask(taskId);
      if (!before) {
        throw new Error(`task not found: ${taskId}`);
      }
      validatePeriodKey({ ...before, ...normalizedPatch });
      const fields = Object.keys(normalizedPatch);
      if (fields.length === 0) {
        return before;
      }
      const params = { id: taskId, updatedAt: now };
      const assignments = fields.map((field) => {
        const column = TASK_FIELD_TO_COLUMN[field];
        params[field] = normalizedPatch[field];
        return `${column} = :${field}`;
      });
      assignments.push("updated_at = :updatedAt");
      this.db.prepare(`
        UPDATE managed_tasks
        SET ${assignments.join(", ")}
        WHERE id = :id
      `).run(params);
      const after = this.getTask(taskId);
      const changes = diffTasks(before, after);
      if (Object.keys(changes).length > 0) {
        this.appendAuditEvent({
          taskId,
          eventType: options.eventType || "update",
          actor: options.actor,
          sessionId: options.sessionId,
          message: options.message,
          createdAt: now,
          changes,
        });
        if (before.status !== after.status && (options.eventType || "update") !== "status_change") {
          this.appendAuditEvent({
            taskId,
            eventType: "status_change",
            actor: options.actor,
            sessionId: options.sessionId,
            message: options.message || `status changed from ${before.status} to ${after.status}`,
            createdAt: now,
            changes: { status: changes.status },
          });
        }
      }
      return after;
    });
  }

  claimTask(id, request = {}) {
    const taskId = requiredText(id, "task id");
    const parsed = claimTaskSchema.parse(request);
    const assignee = normalizeBoundedText(parsed.assignee, "assignee", MAX_ASSIGNEE_LENGTH);
    const sessionId = normalizeBoundedText(parsed.sessionId, "sessionId", MAX_SESSION_ID_LENGTH);
    const now = normalizeDateString(parsed.now || this.now());
    return runImmediateTransaction(this.db, () => {
      const before = this.getTask(taskId);
      if (!before) {
        throw new Error(`task not found: ${taskId}`);
      }
      assertClaimAllowed(before, { assignee, sessionId, force: parsed.force });
      const nextStatus = before.status === "backlog" || before.status === "ready"
        ? "claimed"
        : before.status;
      this.db.prepare(`
        UPDATE managed_tasks
        SET assignee = :assignee,
            claimed_by = :assignee,
            claim_session_id = :sessionId,
            claimed_at = :claimedAt,
            status = :status,
            updated_at = :updatedAt
        WHERE id = :id
      `).run({
        id: taskId,
        assignee,
        sessionId,
        claimedAt: now,
        status: nextStatus,
        updatedAt: now,
      });
      const after = this.getTask(taskId);
      const changes = diffTasks(before, after);
      this.appendAuditEvent({
        taskId,
        eventType: "claim",
        actor: parsed.actor || assignee,
        sessionId,
        message: parsed.message,
        createdAt: now,
        changes,
      });
      if (before.status !== after.status) {
        this.appendAuditEvent({
          taskId,
          eventType: "status_change",
          actor: parsed.actor || assignee,
          sessionId,
          message: `status changed from ${before.status} to ${after.status}`,
          createdAt: now,
          changes: { status: changes.status },
        });
      }
      return after;
    });
  }

  dispatchTask(id, request = {}) {
    const taskId = requiredText(id, "task id");
    const parsed = dispatchTaskSchema.parse(request);
    const sessionId = normalizeBoundedText(parsed.sessionId, "sessionId", MAX_SESSION_ID_LENGTH);
    const assignee = normalizeBoundedText(parsed.assignee, "assignee", MAX_ASSIGNEE_LENGTH);
    const branch = normalizeBoundedText(parsed.branch, "branch", MAX_BRANCH_LENGTH);
    const target = normalizeBoundedText(parsed.target, "target", MAX_DISPATCH_TARGET_LENGTH);
    const agentdeskTaskId = normalizeBoundedText(parsed.agentdeskTaskId, "agentdeskTaskId", MAX_SESSION_ID_LENGTH);
    const now = normalizeDateString(parsed.now || this.now());
    return runImmediateTransaction(this.db, () => {
      const before = this.getTask(taskId);
      if (!before) {
        throw new Error(`task not found: ${taskId}`);
      }
      assertDispatchAllowed(before, { assignee, sessionId, force: parsed.force });
      const nextAssignee = assignee || before.assignee;
      this.db.prepare(`
        UPDATE managed_tasks
        SET assignee = :assignee,
            dispatch_session_id = :sessionId,
            dispatched_at = :dispatchedAt,
            branch = COALESCE(NULLIF(:branch, ''), branch),
            status = :status,
            updated_at = :updatedAt
        WHERE id = :id
      `).run({
        id: taskId,
        assignee: nextAssignee,
        sessionId,
        dispatchedAt: now,
        branch,
        status: "dispatched",
        updatedAt: now,
      });
      const after = this.getTask(taskId);
      const changes = diffTasks(before, after);
      this.appendAuditEvent({
        taskId,
        eventType: "dispatch",
        actor: parsed.actor || nextAssignee,
        sessionId,
        message: parsed.message,
        createdAt: now,
        changes: {
          ...changes,
          dispatchMetadata: {
            target,
            agentdeskTaskId,
          },
        },
      });
      if (before.status !== after.status) {
        this.appendAuditEvent({
          taskId,
          eventType: "status_change",
          actor: parsed.actor || nextAssignee,
          sessionId,
          message: `status changed from ${before.status} to ${after.status}`,
          createdAt: now,
          changes: { status: changes.status },
        });
      }
      return after;
    });
  }

  changeTaskStatus(id, status, options = {}) {
    const taskId = requiredText(id, "task id");
    const parsed = statusChangeSchema.parse({
      ...options,
      status,
    });
    const normalizedStatus = normalizeStatus(parsed.status);
    return this.updateTask(taskId, { status: normalizedStatus }, {
      eventType: "status_change",
      actor: parsed.actor,
      sessionId: parsed.sessionId,
      message: parsed.message,
      now: parsed.now || this.now(),
    });
  }

  appendAuditEvent(input = {}) {
    const parsed = auditEventSchema.parse(input);
    const eventType = normalizeAuditEventType(parsed.eventType);
    const createdAt = normalizeDateString(parsed.createdAt || this.now());
    const changesJson = JSON.stringify(parsed.changes || {});
    this.db.prepare(`
      INSERT INTO managed_task_audit_events (
        task_id, event_type, actor, session_id, message, changes_json, created_at
      ) VALUES (
        :taskId, :eventType, :actor, :sessionId, :message, :changesJson, :createdAt
      )
    `).run({
      taskId: parsed.taskId,
      eventType,
      actor: normalizeBoundedText(parsed.actor, "actor", MAX_ASSIGNEE_LENGTH),
      sessionId: normalizeBoundedText(parsed.sessionId, "sessionId", MAX_SESSION_ID_LENGTH),
      message: normalizeOptionalString(parsed.message),
      changesJson,
      createdAt,
    });
  }

  getAuditEvents(taskId, options = {}) {
    const normalizedTaskId = requiredText(taskId, "task id");
    const limit = clampInteger(options.limit, 200, 1, 1000);
    return this.db.prepare(`
      SELECT * FROM managed_task_audit_events
      WHERE task_id = ?
      ORDER BY event_id ASC
      LIMIT ?
    `).all(normalizedTaskId, limit).map(rowToAuditEvent);
  }
}

export async function registerTaskMarkdown(store, options = {}) {
  const sourcePath = normalizeSourcePath(options.sourcePath || options.filePath || options.path);
  if (!sourcePath) {
    throw new Error("sourcePath is required");
  }
  const markdown = options.markdown === undefined
    ? await fsp.readFile(sourcePath, "utf8")
    : String(options.markdown || "");
  const stat = await fsp.stat(sourcePath).catch(() => null);
  const source = classifyTaskMarkdownSource(sourcePath, options.projectRoot || store?.projectRoot);
  const meta = await readTaskMetaForMarkdown(sourcePath, source);
  const now = normalizeDateString(options.now || meta.updatedAt || stat?.mtime?.toISOString() || new Date().toISOString());
  const title = normalizeOptionalString(options.title)
    || normalizeOptionalString(meta.title || meta.name)
    || extractMarkdownTitle(markdown)
    || path.basename(sourcePath);
  const description = normalizeOptionalString(options.description)
    || normalizeOptionalString(meta.brief)
    || extractMarkdownDescription(markdown);
  const projectRoot = resolveProjectRoot(options.projectRoot || meta.projectRoot || source.projectRoot || store?.projectRoot);
  const task = store.upsertTask({
    id: normalizeOptionalString(options.id) || source.taskId || buildMarkdownTaskId(sourcePath, title),
    title,
    description,
    taskType: options.taskType || source.taskType || DEFAULT_TASK_TYPE,
    periodType: options.periodType || DEFAULT_PERIOD_TYPE,
    periodKey: options.periodKey || "",
    status: options.status || normalizeLegacyStatus(meta.status) || "ready",
    priority: options.priority,
    assignee: options.assignee || meta.assignee || "",
    projectRoot,
    branch: options.branch || "",
    sourceType: options.sourceType || source.sourceType,
    sourcePath,
    sourceFingerprint: fingerprintMarkdownSource(markdown, stat),
    createdAt: options.createdAt || meta.createdAt || now,
    updatedAt: now,
    dueAt: options.dueAt || null,
  }, {
    eventType: options.eventType || "register",
    actor: options.actor,
    sessionId: options.sessionId,
    message: options.message || `registered markdown task source ${sourcePath}`,
    now,
  });
  return {
    ...task,
    markdownPath: sourcePath,
    source,
  };
}

export async function backfillTaskMarkdownSources(store, options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot || store?.projectRoot);
  const sources = await discoverTaskMarkdownSources({
    projectRoot,
    deskRoot: options.deskRoot,
    includeProjectTaskDir: options.includeProjectTaskDir,
    includeAgentDeskTasks: options.includeAgentDeskTasks,
  });
  const items = [];
  for (const sourcePath of sources) {
    const task = await registerTaskMarkdown(store, {
      ...options,
      projectRoot,
      sourcePath,
      eventType: options.eventType || "backfill",
      message: options.message || "backfilled markdown task source",
    });
    items.push(task);
  }
  items.sort((left, right) => left.id.localeCompare(right.id));
  return {
    projectRoot,
    count: items.length,
    items,
  };
}

export async function discoverTaskMarkdownSources(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const deskRoot = path.resolve(options.deskRoot || path.join(projectRoot, AGENT_DESK_STATE_DIRNAME));
  const includeAgentDeskTasks = options.includeAgentDeskTasks !== false;
  const includeProjectTaskDir = options.includeProjectTaskDir !== false;
  const sources = new Set();
  if (includeAgentDeskTasks) {
    const tasksRoot = path.join(deskRoot, "tasks");
    const entries = await fsp.readdir(tasksRoot, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const taskMd = path.join(tasksRoot, entry.name, "task.md");
      if (await isFile(taskMd)) {
        sources.add(taskMd);
      }
    }
  }
  if (includeProjectTaskDir) {
    const taskDir = path.join(projectRoot, "task");
    const entries = await fsp.readdir(taskDir, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".task.md")) {
        sources.add(path.join(taskDir, entry.name));
      }
    }
  }
  return [...sources].sort();
}

export function classifyTaskMarkdownSource(sourcePath, projectRoot = process.cwd()) {
  const normalizedSourcePath = normalizeSourcePath(sourcePath);
  const normalizedProjectRoot = resolveProjectRoot(projectRoot);
  const relative = path.relative(normalizedProjectRoot, normalizedSourcePath).split(path.sep).join("/");
  const agentDeskTaskMatch = relative.match(/^\.agent-desk\/tasks\/([^/]+)\/task\.md$/);
  if (agentDeskTaskMatch) {
    return {
      sourceType: MARKDOWN_SOURCE_TYPE_AGENT_DESK,
      taskType: "agent-desk",
      taskId: agentDeskTaskMatch[1],
      projectRoot: normalizedProjectRoot,
      relativePath: relative,
    };
  }
  if (/^task\/[^/]+\.task\.md$/.test(relative)) {
    return {
      sourceType: MARKDOWN_SOURCE_TYPE_PROJECT_TASK,
      taskType: DEFAULT_TASK_TYPE,
      taskId: "",
      projectRoot: normalizedProjectRoot,
      relativePath: relative,
    };
  }
  return {
    sourceType: DEFAULT_SOURCE_TYPE,
    taskType: DEFAULT_TASK_TYPE,
    taskId: "",
    projectRoot: normalizedProjectRoot,
    relativePath: relative,
  };
}

const TASK_FIELD_TO_COLUMN = Object.freeze({
  title: "title",
  description: "description",
  taskType: "task_type",
  periodType: "period_type",
  periodKey: "period_key",
  status: "status",
  priority: "priority",
  assignee: "assignee",
  claimedBy: "claimed_by",
  claimSessionId: "claim_session_id",
  claimedAt: "claimed_at",
  dispatchSessionId: "dispatch_session_id",
  dispatchedAt: "dispatched_at",
  projectRoot: "project_root",
  branch: "branch",
  sourceType: "source_type",
  sourcePath: "source_path",
  sourceFingerprint: "source_fingerprint",
  updatedAt: "updated_at",
  dueAt: "due_at",
});

function normalizeTaskForInsert(input, options = {}) {
  const parsed = managedTaskCreateSchema.parse(input);
  const now = normalizeDateString(options.now || new Date().toISOString());
  const title = normalizeTaskTitle(parsed.title);
  const projectRoot = parsed.projectRoot !== undefined
    ? normalizeProjectRootForStorage(parsed.projectRoot)
    : normalizeProjectRootForStorage(options.projectRoot);
  const createdAt = normalizeDateString(parsed.createdAt || now);
  const updatedAt = normalizeDateString(parsed.updatedAt || now);
  const normalized = {
    id: normalizeTaskId(parsed.id || buildTaskId(title, createdAt, projectRoot, parsed.sourcePath)),
    title,
    description: normalizeOptionalString(parsed.description),
    taskType: normalizeTaskType(parsed.taskType || DEFAULT_TASK_TYPE),
    periodType: normalizePeriodType(parsed.periodType || DEFAULT_PERIOD_TYPE),
    periodKey: normalizePeriodKey(parsed.periodType || DEFAULT_PERIOD_TYPE, parsed.periodKey),
    status: normalizeStatus(parsed.status || DEFAULT_TASK_STATUS),
    priority: parsed.priority ?? 0,
    assignee: normalizeBoundedText(parsed.assignee, "assignee", MAX_ASSIGNEE_LENGTH),
    claimedBy: normalizeBoundedText(parsed.claimedBy || parsed.assignee, "claimedBy", MAX_ASSIGNEE_LENGTH),
    claimSessionId: normalizeBoundedText(parsed.claimSessionId, "claimSessionId", MAX_SESSION_ID_LENGTH),
    claimedAt: normalizeNullableDateString(parsed.claimedAt),
    dispatchSessionId: normalizeBoundedText(parsed.dispatchSessionId, "dispatchSessionId", MAX_SESSION_ID_LENGTH),
    dispatchedAt: normalizeNullableDateString(parsed.dispatchedAt),
    projectRoot,
    branch: normalizeBoundedText(parsed.branch, "branch", MAX_BRANCH_LENGTH),
    sourceType: normalizeSourceType(parsed.sourceType || DEFAULT_SOURCE_TYPE),
    sourcePath: normalizeSourcePath(parsed.sourcePath),
    sourceFingerprint: normalizeOptionalString(parsed.sourceFingerprint),
    createdAt,
    updatedAt,
    dueAt: normalizeNullableDateString(parsed.dueAt),
  };
  validatePeriodKey(normalized);
  return normalized;
}

function normalizeTaskPatch(patch) {
  const normalized = {};
  for (const [field, value] of Object.entries(patch)) {
    if (field === "updatedAt") {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (field === "title") {
      normalized.title = normalizeTaskTitle(value);
    } else if (field === "description") {
      normalized.description = normalizeOptionalString(value);
    } else if (field === "taskType") {
      normalized.taskType = normalizeTaskType(value || DEFAULT_TASK_TYPE);
    } else if (field === "periodType") {
      normalized.periodType = normalizePeriodType(value || DEFAULT_PERIOD_TYPE);
    } else if (field === "periodKey") {
      normalized.periodKey = normalizeBoundedText(value, "periodKey", MAX_PERIOD_KEY_LENGTH);
    } else if (field === "status") {
      normalized.status = normalizeStatus(value || DEFAULT_TASK_STATUS);
    } else if (field === "priority") {
      normalized.priority = clampInteger(value, 0, 0, 999);
    } else if (["assignee", "claimedBy"].includes(field)) {
      normalized[field] = normalizeBoundedText(value, field, MAX_ASSIGNEE_LENGTH);
    } else if (["claimSessionId", "dispatchSessionId"].includes(field)) {
      normalized[field] = normalizeBoundedText(value, field, MAX_SESSION_ID_LENGTH);
    } else if (["claimedAt", "dispatchedAt", "dueAt"].includes(field)) {
      normalized[field] = normalizeNullableDateString(value);
    } else if (field === "projectRoot") {
      normalized.projectRoot = normalizeProjectRootForStorage(value);
    } else if (field === "branch") {
      normalized.branch = normalizeBoundedText(value, "branch", MAX_BRANCH_LENGTH);
    } else if (field === "sourceType") {
      normalized.sourceType = normalizeSourceType(value || DEFAULT_SOURCE_TYPE);
    } else if (field === "sourcePath") {
      normalized.sourcePath = normalizeSourcePath(value);
    } else if (field === "sourceFingerprint") {
      normalized.sourceFingerprint = normalizeOptionalString(value);
    }
  }
  return normalized;
}

function validatePeriodKey(task) {
  if (task.periodType === "none" && task.periodKey) {
    throw new Error("periodKey must be empty when periodType is none");
  }
  if (task.periodType !== "none" && !normalizeOptionalString(task.periodKey)) {
    throw new Error("periodKey is required when periodType is not none");
  }
  if (task.periodType !== "none") {
    canonicalizeTaskPeriodKey(task.periodType, task.periodKey);
  }
}

function assertClaimAllowed(task, request) {
  if (["done", "canceled"].includes(task.status) && !request.force) {
    throw new Error(`cannot claim task in ${task.status} status`);
  }
  if (!task.claimedBy) {
    return;
  }
  const sameAssignee = task.claimedBy === request.assignee;
  const sameSession = !task.claimSessionId || task.claimSessionId === request.sessionId;
  if (!request.force && (!sameAssignee || !sameSession)) {
    const session = task.claimSessionId ? `/${task.claimSessionId}` : "";
    throw new Error(`task already claimed by ${task.claimedBy}${session}`);
  }
}

function assertDispatchAllowed(task, request) {
  if (["done", "canceled"].includes(task.status) && !request.force) {
    throw new Error(`cannot dispatch task in ${task.status} status`);
  }
  if (task.dispatchSessionId && task.dispatchSessionId !== request.sessionId && !request.force) {
    throw new Error(`task already dispatched to session ${task.dispatchSessionId}`);
  }
  if (!task.claimedBy || request.force) {
    return;
  }
  if (request.assignee && task.claimedBy !== request.assignee) {
    throw new Error(`task is claimed by ${task.claimedBy}`);
  }
  if (task.claimSessionId && task.claimSessionId !== request.sessionId) {
    throw new Error(`task is claimed by session ${task.claimSessionId}`);
  }
}

function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    taskType: row.task_type,
    periodType: row.period_type,
    periodKey: row.period_key,
    status: row.status,
    priority: row.priority,
    assignee: row.assignee,
    claimedBy: row.claimed_by,
    claimSessionId: row.claim_session_id,
    claimedAt: row.claimed_at,
    dispatchSessionId: row.dispatch_session_id,
    dispatchedAt: row.dispatched_at,
    projectRoot: row.project_root,
    branch: row.branch,
    sourceType: row.source_type,
    sourcePath: row.source_path,
    sourceFingerprint: row.source_fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dueAt: row.due_at,
  };
}

function rowToAuditEvent(row) {
  return {
    eventId: row.event_id,
    taskId: row.task_id,
    eventType: row.event_type,
    actor: row.actor,
    sessionId: row.session_id,
    message: row.message,
    changes: parseJsonObject(row.changes_json),
    createdAt: row.created_at,
  };
}

function diffTasks(before, after) {
  const changes = {};
  for (const key of Object.keys(after)) {
    if (before[key] === after[key]) {
      continue;
    }
    changes[key] = {
      before: before[key],
      after: after[key],
    };
  }
  return changes;
}

function readUserVersion(db) {
  return Number(db.prepare("PRAGMA user_version").get()?.user_version || 0);
}

function setMetaValue(db, key, value) {
  db.prepare(`
    INSERT INTO agent_desk_store_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function runImmediateTransaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function readTaskMetaForMarkdown(sourcePath, source) {
  if (source.sourceType !== MARKDOWN_SOURCE_TYPE_AGENT_DESK) {
    return {};
  }
  const metaPath = path.join(path.dirname(sourcePath), "meta.json");
  const text = await fsp.readFile(metaPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  if (!text.trim()) {
    return {};
  }
  return parseJsonObject(text);
}

function normalizeLegacyStatus(status) {
  const value = normalizeOptionalString(status).toLowerCase();
  if (!value) {
    return "";
  }
  if (value === "succeeded") {
    return "done";
  }
  if (value === "received" || value === "generating") {
    return "backlog";
  }
  if (value === "ready" || value === "running" || value === "failed") {
    return value;
  }
  return "";
}

function extractMarkdownTitle(markdown) {
  return String(markdown || "").match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() || "";
}

function extractMarkdownDescription(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const collected = [];
  let inGoal = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (inGoal) {
        break;
      }
      inGoal = /^##\s+(?:goal|description|brief)\s*$/i.test(line.trim());
      continue;
    }
    if (!inGoal) {
      continue;
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(line)) {
      break;
    }
    const text = line.trim();
    if (text) {
      collected.push(text);
    }
  }
  return collected.join("\n").trim();
}

function fingerprintMarkdownSource(markdown, stat) {
  const hash = crypto.createHash("sha256");
  hash.update(String(markdown || ""));
  if (stat?.mtimeMs) {
    hash.update(`:${stat.mtimeMs}`);
  }
  if (stat?.size) {
    hash.update(`:${stat.size}`);
  }
  return hash.digest("hex");
}

function buildMarkdownTaskId(sourcePath, title) {
  const basename = path.basename(sourcePath).replace(/(?:\.task)?\.md$/i, "");
  const slugSource = slug(title || basename);
  return normalizeTaskId(`task-md-${slugSource}-${shortHash(path.resolve(sourcePath))}`);
}

function buildTaskId(title, createdAt, projectRoot, sourcePath) {
  const stamp = compactTimestamp(createdAt);
  const slugTitle = slug(title).slice(0, 56);
  const hash = shortHash([title, createdAt, projectRoot, sourcePath || ""].join("\n"));
  return normalizeTaskId(`task-${stamp}-${slugTitle}-${hash}`);
}

function compactTimestamp(value) {
  return normalizeDateString(value)
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-")
    .toLowerCase();
}

function normalizeTaskId(value) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw new Error("task id is required");
  }
  const normalized = text
    .replace(/[^A-Za-z0-9_.:/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH);
  if (!normalized) {
    throw new Error("task id is required");
  }
  return normalized;
}

function normalizeTaskTitle(value) {
  return requiredText(value, "title").replace(/\s+/g, " ").trim();
}

function normalizeTaskType(value) {
  return normalizeBoundedText(value || DEFAULT_TASK_TYPE, "taskType", MAX_TASK_TYPE_LENGTH);
}

function normalizeSourceType(value) {
  return normalizeBoundedText(value || DEFAULT_SOURCE_TYPE, "sourceType", MAX_SOURCE_TYPE_LENGTH);
}

function normalizeStatus(value) {
  const status = normalizeOptionalString(value).toLowerCase();
  if (!TASK_STATUS_SET.has(status)) {
    throw new Error(`unsupported task status: ${value}`);
  }
  return status;
}

function normalizePeriodType(value) {
  const periodType = normalizeOptionalString(value).toLowerCase();
  if (!PERIOD_TYPE_SET.has(periodType)) {
    throw new Error(`unsupported periodType: ${value}`);
  }
  return periodType;
}

function normalizePeriodKey(periodTypeValue, value) {
  const periodType = normalizePeriodType(periodTypeValue);
  if (periodType === "none") {
    return "";
  }
  return canonicalizeTaskPeriodKey(
    periodType,
    normalizeBoundedText(value, "periodKey", MAX_PERIOD_KEY_LENGTH),
  );
}

function normalizeAuditEventType(value) {
  const eventType = normalizeOptionalString(value).toLowerCase();
  if (!TASK_AUDIT_EVENT_TYPE_SET.has(eventType)) {
    throw new Error(`unsupported audit event type: ${value}`);
  }
  return eventType;
}

function normalizeDateString(value) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw new Error("date is required");
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid date: ${value}`);
  }
  return date.toISOString();
}

function normalizeNullableDateString(value) {
  const text = normalizeOptionalString(value);
  return text ? normalizeDateString(text) : null;
}

function normalizeSourcePath(value) {
  const text = normalizeOptionalString(value);
  return text ? path.resolve(text) : "";
}

function normalizeBoundedText(value, label, maxLength) {
  const text = normalizeOptionalString(value).replace(/\s+/g, " ").trim();
  if (text.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters`);
  }
  return text;
}

function requiredText(value, label) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw new Error(`${label} is required`);
  }
  return text;
}

function normalizeOptionalString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isValidDateString(value) {
  return !Number.isNaN(new Date(value).getTime());
}

function parseJsonObject(text) {
  try {
    const value = JSON.parse(String(text || "{}"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function resolveProjectRoot(value) {
  return path.resolve(
    normalizeOptionalString(value)
      || normalizeOptionalString(process.env.AGENT_DESK_PROJECT_ROOT)
      || normalizeOptionalString(process.env.INIT_CWD)
      || process.cwd(),
  );
}

function normalizeProjectRootForStorage(value) {
  const text = normalizeOptionalString(value);
  return text ? path.resolve(text) : "";
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function slug(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "task";
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

async function isFile(filePath) {
  const stat = await fsp.stat(filePath).catch(() => null);
  return Boolean(stat?.isFile());
}
