import { mockAgentDeskApi } from "./mockStore";
import type {
  AgentDeskTaskDetail,
  ApiResult,
  ClaimTaskInput,
  DispatchTaskInput,
  SessionSummary,
  TaskFilters,
  TaskListResponse,
  TaskMutationInput,
} from "./types";

export const AGENTDESK_API_ROUTES = {
  tasks: "/tasks",
  task: (taskId: string) => `/tasks/${encodeURIComponent(taskId)}`,
  claimTask: (taskId: string) => `/tasks/${encodeURIComponent(taskId)}/claim`,
  dispatchTask: (taskId: string) => `/tasks/${encodeURIComponent(taskId)}/dispatch`,
  recentSessions: "/sessions/recent",
};

function getApiBaseUrl(): string {
  return import.meta.env.VITE_AGENTDESK_API_BASE_URL || "/api/agentdesk";
}

function shouldForceMocks(): boolean {
  return import.meta.env.VITE_AGENTDESK_USE_MOCKS === "true";
}

function buildUrl(route: string, params: Record<string, string | number | undefined> = {}): string {
  const baseUrl = getApiBaseUrl().replace(/\/$/, "");
  const url = new URL(`${baseUrl}${route}`, window.location.origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || `HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload && typeof payload === "object" && "ok" in payload && "data" in payload) {
    return payload.data as T;
  }
  return payload as T;
}

function fallbackWarning(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (!message || message.includes("HTTP 500") || message.includes("ECONNREFUSED")) {
    return "Local HTTP API unavailable; showing fixtures.";
  }

  return message;
}

async function withFallback<T>(
  route: string,
  init: RequestInit | undefined,
  fallback: () => Promise<T>,
  params?: Record<string, string | number | undefined>,
): Promise<ApiResult<T>> {
  if (shouldForceMocks()) {
    return {
      data: await fallback(),
      source: "mock",
      warning: "Fixture mode is enabled with VITE_AGENTDESK_USE_MOCKS=true.",
    };
  }

  try {
    return {
      data: await requestJson<T>(buildUrl(route, params), init),
      source: "api",
    };
  } catch (error) {
    return {
      data: await fallback(),
      source: "mock",
      warning: fallbackWarning(error),
    };
  }
}

export const agentDeskApi = {
  listTasks(projectRoot: string, filters: TaskFilters): Promise<ApiResult<TaskListResponse>> {
    return withFallback(
      AGENTDESK_API_ROUTES.tasks,
      undefined,
      () => mockAgentDeskApi.listTasks(projectRoot, filters),
      {
        projectRoot,
        range: filters.range,
        status: filters.status === "all" ? undefined : filters.status,
        query: filters.query,
        assignee: filters.assignee,
      },
    );
  },

  getTask(projectRoot: string, taskId: string): Promise<ApiResult<AgentDeskTaskDetail>> {
    return withFallback(
      AGENTDESK_API_ROUTES.task(taskId),
      undefined,
      () => mockAgentDeskApi.getTask(taskId),
      { projectRoot },
    );
  },

  createTask(input: TaskMutationInput): Promise<ApiResult<AgentDeskTaskDetail>> {
    return withFallback(
      AGENTDESK_API_ROUTES.tasks,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      () => mockAgentDeskApi.createTask(input),
    );
  },

  updateTask(taskId: string, input: TaskMutationInput): Promise<ApiResult<AgentDeskTaskDetail>> {
    return withFallback(
      AGENTDESK_API_ROUTES.task(taskId),
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
      () => mockAgentDeskApi.updateTask(taskId, input),
    );
  },

  claimTask(taskId: string, input: ClaimTaskInput): Promise<ApiResult<AgentDeskTaskDetail>> {
    return withFallback(
      AGENTDESK_API_ROUTES.claimTask(taskId),
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      () => mockAgentDeskApi.claimTask(taskId, input),
    );
  },

  dispatchTask(taskId: string, input: DispatchTaskInput): Promise<ApiResult<AgentDeskTaskDetail>> {
    return withFallback(
      AGENTDESK_API_ROUTES.dispatchTask(taskId),
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      () => mockAgentDeskApi.dispatchTask(taskId, input),
    );
  },

  listRecentSessions(projectRoot: string, limit = 6): Promise<ApiResult<SessionSummary[]>> {
    return withFallback(
      AGENTDESK_API_ROUTES.recentSessions,
      undefined,
      () => mockAgentDeskApi.listRecentSessions(projectRoot, limit),
      { projectRoot, limit },
    );
  },
};
