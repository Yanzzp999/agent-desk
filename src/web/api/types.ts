export type TaskRange = "day" | "week" | "month";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type TaskScope = "project" | "user";

export type TaskStatus =
  | "draft"
  | "ready"
  | "claimed"
  | "running"
  | "blocked"
  | "succeeded"
  | "failed";

export const TASK_STATUSES: TaskStatus[] = [
  "draft",
  "ready",
  "claimed",
  "running",
  "blocked",
  "succeeded",
  "failed",
];

export interface TaskFilters {
  range: TaskRange;
  status: TaskStatus | "all";
  query: string;
  assignee: string;
}

export interface AgentDeskTask {
  taskId: string;
  title: string;
  brief: string;
  status: TaskStatus;
  priority: TaskPriority;
  scope: TaskScope;
  taskType: string;
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
  tags: string[];
  subtaskCount: number;
  completedSubtasks: number;
  claimedBy?: string;
  activeSessionId?: string;
  activeSessionStatus?: SessionStatus;
  paths: {
    taskMd: string;
    memoryMd?: string;
  };
}

/** A single subtask parsed from the task markdown checklist. */
export interface SubtaskRow {
  title: string;
  checked: boolean;
  /** Optional per-subtask concurrency override; 1 means "run exclusively". Empty = inherit task default. */
  parallel?: number;
}

export interface AgentDeskTaskDetail extends AgentDeskTask {
  markdown: string;
  memory: string;
  /** Structured subtasks derived server-side from the markdown checklist. */
  subtasks?: SubtaskRow[];
  recentSessions: SessionSummary[];
}

/** Result of the AI-assisted subtask breakdown endpoint (a draft, not yet saved). */
export interface BreakdownResult {
  taskId: string;
  markdown: string;
  subtasks: SubtaskRow[];
}

export type SessionStatus =
  | "queued"
  | "waiting_for_app"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface SessionSummary {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  status: SessionStatus;
  startedAt: string;
  finishedAt?: string;
  model: "gpt-5.5" | string;
  reasoning: "xhigh" | string;
  serviceTier: "fast" | string;
  parallel: number;
  launchBatchSize: number;
  agents: {
    total: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  lastError?: string;
}

export interface TaskListSummary {
  total: number;
  ready: number;
  running: number;
  blocked: number;
  succeeded: number;
}

export interface TaskListResponse {
  items: AgentDeskTask[];
  summary: TaskListSummary;
}

export interface TaskMutationInput {
  projectRoot: string;
  scope: TaskScope;
  taskType: string;
  title: string;
  brief: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
}

export interface ClaimTaskInput {
  projectRoot: string;
  assignee: string;
  sessionId?: string;
}

export interface DispatchTaskInput {
  projectRoot: string;
  model: "gpt-5.5" | string;
  reasoning: "xhigh" | string;
  serviceTier: "fast" | string;
  parallel: number;
  launchBatchSize: number;
}

export type ApiSource = "api" | "mock";

export interface ApiResult<T> {
  data: T;
  source: ApiSource;
  warning?: string;
}

// ============================================================
// 新增：Workspace 树导航相关轻量类型（支持项目-任务树模式）
// 设计目标：前端聚合现有 Task 数据即可使用，零后端依赖（可选后端 /projects 端点增强）
// ============================================================

/** 树中展示的精简项目分组信息 */
export interface WorkspaceProject {
  projectRoot: string;
  shortName: string;
  taskCount: number;
  /** 最近更新时间（用于排序） */
  lastUpdatedAt: string;
}

/** 树中单个可点击任务节点（从 AgentDeskTask 派生，保持轻量） */
export interface WorkspaceNavTask {
  taskId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  updatedAt: string;
  claimedBy?: string;
  subtaskProgress: number; // 0-100
  hasActiveSession: boolean;
}

/** 完整树节点：项目 + 其下的任务列表（默认只展开最近若干个） */
export interface WorkspaceProjectGroup {
  project: WorkspaceProject;
  tasks: WorkspaceNavTask[];
  /** 是否默认展开（用户级任务分区特殊处理） */
  defaultExpanded?: boolean;
}

/** Composer 可选参数（与 dispatch 默认保持一致） */
export interface ComposerLaunchParams {
  model: string;
  reasoning: string;
  serviceTier: string;
}
