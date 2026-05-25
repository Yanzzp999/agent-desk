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

export interface AgentDeskTaskDetail extends AgentDeskTask {
  markdown: string;
  memory: string;
  recentSessions: SessionSummary[];
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
