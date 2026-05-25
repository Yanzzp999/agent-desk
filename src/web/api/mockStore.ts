import { buildFixtureTaskDetail, fixtureSessions, fixtureTasks } from "./fixtures";
import type {
  AgentDeskTask,
  AgentDeskTaskDetail,
  ClaimTaskInput,
  DispatchTaskInput,
  SessionSummary,
  TaskFilters,
  TaskListResponse,
  TaskListSummary,
  TaskMutationInput,
} from "./types";

const TASK_STORE_KEY = "agentdesk.web.mock.tasks";
const SESSION_STORE_KEY = "agentdesk.web.mock.sessions";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function readStore<T>(key: string, fallback: T): T {
  if (!canUseStorage()) {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeStore<T>(key: string, value: T): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function readTasks(): AgentDeskTask[] {
  return readStore(TASK_STORE_KEY, fixtureTasks);
}

function writeTasks(tasks: AgentDeskTask[]): void {
  writeStore(TASK_STORE_KEY, tasks);
}

function readSessions(): SessionSummary[] {
  return readStore(SESSION_STORE_KEY, fixtureSessions);
}

function writeSessions(sessions: SessionSummary[]): void {
  writeStore(SESSION_STORE_KEY, sessions);
}

function summarize(tasks: AgentDeskTask[]): TaskListSummary {
  return {
    total: tasks.length,
    ready: tasks.filter((task) => task.status === "ready").length,
    running: tasks.filter((task) => task.status === "running").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    succeeded: tasks.filter((task) => task.status === "succeeded").length,
  };
}

function matchesRange(task: AgentDeskTask, range: TaskFilters["range"]): boolean {
  const reference = new Date(task.dueAt || task.updatedAt).getTime();
  const now = Date.now();
  const ageHours = Math.abs(reference - now) / 36e5;

  if (range === "day") {
    return ageHours <= 24 || task.priority === "urgent" || task.status === "running";
  }

  if (range === "week") {
    return ageHours <= 24 * 7 || task.status !== "succeeded";
  }

  return true;
}

function applyFilters(tasks: AgentDeskTask[], filters: TaskFilters): AgentDeskTask[] {
  const query = filters.query.trim().toLowerCase();
  const assignee = filters.assignee.trim().toLowerCase();

  return tasks
    .filter((task) => matchesRange(task, filters.range))
    .filter((task) => filters.status === "all" || task.status === filters.status)
    .filter((task) => !assignee || (task.claimedBy || "").toLowerCase().includes(assignee))
    .filter((task) => {
      if (!query) {
        return true;
      }

      return [
        task.taskId,
        task.title,
        task.brief,
        task.status,
        task.priority,
        ...task.tags,
      ].some((value) => value.toLowerCase().includes(query));
    })
    .sort((left, right) => {
      const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
      const priorityDelta = priorityRank[left.priority] - priorityRank[right.priority];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
}

function taskPath(projectRoot: string, taskId: string, fileName: string): string {
  return `${projectRoot}/.agent-desk/tasks/${taskId}/${fileName}`;
}

function findTaskOrThrow(taskId: string): AgentDeskTask {
  const task = readTasks().find((item) => item.taskId === taskId);

  if (!task) {
    throw new Error(`Mock task not found: ${taskId}`);
  }

  return task;
}

export const mockAgentDeskApi = {
  async listTasks(projectRoot: string, filters: TaskFilters): Promise<TaskListResponse> {
    const tasks = readTasks().map((task) => ({
      ...task,
      projectRoot: projectRoot || task.projectRoot,
    }));
    const items = applyFilters(tasks, filters);

    return {
      items,
      summary: summarize(items),
    };
  },

  async getTask(taskId: string): Promise<AgentDeskTaskDetail> {
    return buildFixtureTaskDetail(findTaskOrThrow(taskId));
  },

  async createTask(input: TaskMutationInput): Promise<AgentDeskTaskDetail> {
    const now = new Date().toISOString();
    const slug = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 36) || "task";
    const taskId = `task-${Date.now()}-${slug}`;
    const task: AgentDeskTask = {
      taskId,
      title: input.title,
      brief: input.brief,
      status: input.status,
      priority: input.priority,
      projectRoot: input.projectRoot,
      createdAt: now,
      updatedAt: now,
      tags: input.tags,
      subtaskCount: 0,
      completedSubtasks: 0,
      paths: {
        taskMd: taskPath(input.projectRoot, taskId, "task.md"),
        memoryMd: taskPath(input.projectRoot, taskId, "memory.md"),
      },
    };

    writeTasks([task, ...readTasks()]);
    return buildFixtureTaskDetail(task);
  },

  async updateTask(taskId: string, input: TaskMutationInput): Promise<AgentDeskTaskDetail> {
    let updatedTask: AgentDeskTask | undefined;
    const tasks = readTasks().map((task) => {
      if (task.taskId !== taskId) {
        return task;
      }

      updatedTask = {
        ...task,
        title: input.title,
        brief: input.brief,
        status: input.status,
        priority: input.priority,
        projectRoot: input.projectRoot,
        tags: input.tags,
        updatedAt: new Date().toISOString(),
        paths: {
          taskMd: taskPath(input.projectRoot, taskId, "task.md"),
          memoryMd: taskPath(input.projectRoot, taskId, "memory.md"),
        },
      };
      return updatedTask;
    });

    if (!updatedTask) {
      throw new Error(`Mock task not found: ${taskId}`);
    }

    writeTasks(tasks);
    return buildFixtureTaskDetail(updatedTask);
  },

  async claimTask(taskId: string, input: ClaimTaskInput): Promise<AgentDeskTaskDetail> {
    let claimedTask: AgentDeskTask | undefined;
    const tasks = readTasks().map((task) => {
      if (task.taskId !== taskId) {
        return task;
      }

      claimedTask = {
        ...task,
        status: "claimed",
        projectRoot: input.projectRoot,
        claimedBy: input.assignee,
        updatedAt: new Date().toISOString(),
      };
      return claimedTask;
    });

    if (!claimedTask) {
      throw new Error(`Mock task not found: ${taskId}`);
    }

    writeTasks(tasks);
    return buildFixtureTaskDetail(claimedTask);
  },

  async dispatchTask(taskId: string, input: DispatchTaskInput): Promise<AgentDeskTaskDetail> {
    const sessionId = `session-${Date.now()}-${taskId.slice(0, 18)}`;
    let dispatchedTask: AgentDeskTask | undefined;
    const tasks = readTasks().map((task) => {
      if (task.taskId !== taskId) {
        return task;
      }

      dispatchedTask = {
        ...task,
        status: "running",
        projectRoot: input.projectRoot,
        activeSessionId: sessionId,
        activeSessionStatus: "running",
        updatedAt: new Date().toISOString(),
      };
      return dispatchedTask;
    });

    if (!dispatchedTask) {
      throw new Error(`Mock task not found: ${taskId}`);
    }

    const session: SessionSummary = {
      sessionId,
      taskId,
      taskTitle: dispatchedTask.title,
      status: "running",
      startedAt: new Date().toISOString(),
      model: input.model,
      reasoning: input.reasoning,
      serviceTier: input.serviceTier,
      parallel: input.parallel,
      launchBatchSize: input.launchBatchSize,
      agents: {
        total: input.parallel,
        running: input.parallel,
        succeeded: 0,
        failed: 0,
      },
    };

    writeTasks(tasks);
    writeSessions([session, ...readSessions()]);
    return buildFixtureTaskDetail(dispatchedTask);
  },

  async listRecentSessions(projectRoot: string, limit = 6): Promise<SessionSummary[]> {
    const tasks = readTasks();
    const matchingTasks = tasks.filter((task) => !projectRoot || task.projectRoot === projectRoot);
    const taskIds = new Set((matchingTasks.length > 0 ? matchingTasks : tasks)
      .map((task) => task.taskId));

    return readSessions()
      .filter((session) => taskIds.has(session.taskId))
      .slice(0, limit);
  },
};
