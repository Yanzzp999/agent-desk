import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  CirclePlay,
  FolderGit2,
  ListChecks,
  RefreshCw,
  ShieldAlert,
  Trophy,
} from "lucide-react";

import { agentDeskApi } from "./api/client";
import { validateProjectRoot } from "./api/projectRoot";
import type {
  AgentDeskTask,
  AgentDeskTaskDetail,
  ApiResult,
  ApiSource,
  SessionSummary as SessionSummaryValue,
  TaskFilters as TaskFiltersValue,
  TaskListSummary,
  TaskMutationInput,
} from "./api/types";
import { SessionSummary } from "./components/SessionSummary";
import { TaskDetail } from "./components/TaskDetail";
import { TaskFilters } from "./components/TaskFilters";
import { TaskForm } from "./components/TaskForm";
import { TaskList } from "./components/TaskList";
import "./styles/app.css";

const PROJECT_ROOT_STORAGE_KEY = "agentdesk.web.projectRoot";

const defaultFilters: TaskFiltersValue = {
  range: "week",
  status: "all",
  query: "",
  assignee: "",
};

const emptySummary: TaskListSummary = {
  total: 0,
  ready: 0,
  running: 0,
  blocked: 0,
  succeeded: 0,
};

const summaryItems = [
  { key: "total", label: "Total", icon: ListChecks },
  { key: "ready", label: "Ready", icon: CircleDot },
  { key: "running", label: "Running", icon: CirclePlay },
  { key: "blocked", label: "Blocked", icon: ShieldAlert },
  { key: "succeeded", label: "Succeeded", icon: Trophy },
] as const;

function readInitialProjectRoot(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(PROJECT_ROOT_STORAGE_KEY)
    || import.meta.env.VITE_AGENTDESK_PROJECT_ROOT
    || "";
}

function createBlankDraft(projectRoot: string): TaskMutationInput {
  const hasProjectRoot = projectRoot.trim().length > 0;
  return {
    projectRoot: hasProjectRoot ? projectRoot : "",
    scope: hasProjectRoot ? "project" : "user",
    taskType: hasProjectRoot ? "coding" : "general",
    title: "",
    brief: "",
    status: "draft",
    priority: "normal",
    tags: [],
  };
}

function taskToDraft(task: AgentDeskTaskDetail): TaskMutationInput {
  const scope = task.scope || (task.projectRoot ? "project" : "user");
  return {
    projectRoot: task.projectRoot,
    scope,
    taskType: task.taskType || (scope === "project" ? "coding" : "general"),
    title: task.title,
    brief: task.brief,
    status: task.status,
    priority: task.priority,
    tags: task.tags,
  };
}

function combineNotice(results: Array<ApiResult<unknown>>): { source: ApiSource; warning?: string } {
  const fallback = results.find((result) => result.source === "mock");

  if (fallback) {
    return {
      source: "mock",
      warning: fallback.warning,
    };
  }

  return { source: "api" };
}

export default function App() {
  const [projectRoot, setProjectRoot] = useState(readInitialProjectRoot);
  const [filters, setFilters] = useState<TaskFiltersValue>(defaultFilters);
  const [tasks, setTasks] = useState<AgentDeskTask[]>([]);
  const [summary, setSummary] = useState<TaskListSummary>(emptySummary);
  const [sessions, setSessions] = useState<SessionSummaryValue[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [taskDetail, setTaskDetail] = useState<AgentDeskTaskDetail | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [draft, setDraft] = useState<TaskMutationInput>(() => createBlankDraft(projectRoot.trim()));
  const [apiNotice, setApiNotice] = useState<{ source: ApiSource; warning?: string }>({ source: "mock" });
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const projectRootValidation = useMemo(() => validateProjectRoot(projectRoot), [projectRoot]);
  const canMutate = !isMutating && (!taskDetail || taskDetail.scope === "user" || projectRootValidation.valid);
  const canSubmit = !isMutating
    && draft.title.trim().length > 0
    && draft.brief.trim().length > 0
    && (draft.scope === "user" || projectRootValidation.valid)
    && (formMode === "create" || Boolean(selectedTaskId));

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PROJECT_ROOT_STORAGE_KEY, projectRoot);
    }

    setDraft((current) => current.scope === "project"
      ? {
        ...current,
        projectRoot: projectRoot.trim(),
        taskType: current.taskType || "coding",
      }
      : current);
  }, [projectRoot]);

  useEffect(() => {
    let isActive = true;

    async function loadDashboard() {
      setIsLoading(true);

      const [taskResult, sessionResult] = await Promise.all([
        agentDeskApi.listTasks(projectRoot.trim(), filters),
        agentDeskApi.listRecentSessions(projectRoot.trim(), 6),
      ]);

      if (!isActive) {
        return;
      }

      setTasks(taskResult.data.items);
      setSummary(taskResult.data.summary);
      setSessions(sessionResult.data);
      setApiNotice(combineNotice([taskResult, sessionResult]));

      setSelectedTaskId((current) => {
        if (current && taskResult.data.items.some((task) => task.taskId === current)) {
          return current;
        }

        return taskResult.data.items[0]?.taskId;
      });
      setIsLoading(false);
    }

    void loadDashboard().catch((error) => {
      if (!isActive) {
        return;
      }

      setApiNotice({ source: "mock", warning: error instanceof Error ? error.message : "Dashboard load failed." });
      setIsLoading(false);
    });

    return () => {
      isActive = false;
    };
  }, [filters, projectRoot]);

  useEffect(() => {
    let isActive = true;

    async function loadTaskDetail() {
      if (!selectedTaskId) {
        setTaskDetail(null);
        return;
      }

      const result = await agentDeskApi.getTask(projectRoot.trim(), selectedTaskId);

      if (!isActive) {
        return;
      }

      setTaskDetail(result.data);
      setApiNotice((current) => result.source === "mock" ? { source: "mock", warning: result.warning } : current);

      if (formMode === "edit") {
        setDraft(taskToDraft(result.data));
      }
    }

    void loadTaskDetail().catch((error) => {
      if (!isActive) {
        return;
      }

      setTaskDetail(null);
      setApiNotice({ source: "mock", warning: error instanceof Error ? error.message : "Task detail failed." });
    });

    return () => {
      isActive = false;
    };
  }, [formMode, projectRoot, selectedTaskId]);

  async function refreshDashboard() {
    const [taskResult, sessionResult] = await Promise.all([
      agentDeskApi.listTasks(projectRoot.trim(), filters),
      agentDeskApi.listRecentSessions(projectRoot.trim(), 6),
    ]);

    setTasks(taskResult.data.items);
    setSummary(taskResult.data.summary);
    setSessions(sessionResult.data);
    setApiNotice(combineNotice([taskResult, sessionResult]));
  }

  function handleFormModeChange(mode: "create" | "edit") {
    setFormMode(mode);

    if (mode === "create") {
      setDraft(createBlankDraft(projectRoot.trim()));
    } else if (taskDetail) {
      setDraft(taskToDraft(taskDetail));
    }
  }

  async function submitTaskForm() {
    if (!canSubmit) {
      return;
    }

    setIsMutating(true);

    const input: TaskMutationInput = {
      ...draft,
      projectRoot: draft.scope === "project" ? projectRoot.trim() : "",
      taskType: draft.scope === "project" ? "coding" : "general",
      title: draft.title.trim(),
      brief: draft.brief.trim(),
    };

    const result = formMode === "create"
      ? await agentDeskApi.createTask(input)
      : await agentDeskApi.updateTask(selectedTaskId || "", input);

    setApiNotice({ source: result.source, warning: result.warning });
    setSelectedTaskId(result.data.taskId);
    setTaskDetail(result.data);
    setFormMode("edit");
    setDraft(taskToDraft(result.data));
    await refreshDashboard();
    setIsMutating(false);
  }

  async function claimSelectedTask() {
    if (!taskDetail || !canMutate) {
      return;
    }

    setIsMutating(true);
    const result = await agentDeskApi.claimTask(taskDetail.taskId, {
      projectRoot: taskDetail.projectRoot || projectRoot.trim(),
      assignee: filters.assignee.trim() || "codex-ui",
      sessionId: `ui-${Date.now()}`,
    });

    setTaskDetail(result.data);
    if (formMode === "edit") {
      setDraft(taskToDraft(result.data));
    }
    setApiNotice({ source: result.source, warning: result.warning });
    await refreshDashboard();
    setIsMutating(false);
  }

  async function dispatchSelectedTask() {
    if (!taskDetail || !canMutate) {
      return;
    }

    setIsMutating(true);
    const result = await agentDeskApi.dispatchTask(taskDetail.taskId, {
      projectRoot: taskDetail.projectRoot || projectRoot.trim(),
      model: "gpt-5.5",
      reasoning: "xhigh",
      serviceTier: "fast",
      parallel: 6,
      launchBatchSize: 6,
    });

    setTaskDetail(result.data);
    if (formMode === "edit") {
      setDraft(taskToDraft(result.data));
    }
    setApiNotice({ source: result.source, warning: result.warning });
    await refreshDashboard();
    setIsMutating(false);
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Workspace navigation">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">AD</span>
          <div className="brand-text">
            <strong>AgentDesk</strong>
            <span>Beta console</span>
          </div>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-label">Project root</p>
          <div className="project-root-control">
            <label className="field">
              <span>Project root</span>
              <div className="input-with-icon project-input">
                <FolderGit2 aria-hidden="true" size={15} />
                <input
                  value={projectRoot}
                  placeholder="/Users/me/work/repo"
                  onChange={(event) => setProjectRoot(event.target.value)}
                />
              </div>
            </label>
            <p className={`validation-message ${projectRootValidation.valid ? "is-valid" : "is-invalid"}`}>
              {projectRootValidation.valid
                ? <CheckCircle2 aria-hidden="true" size={13} />
                : <AlertTriangle aria-hidden="true" size={13} />}
              {projectRootValidation.message}
            </p>
          </div>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-label">Overview</p>
          <div className="summary-stack" aria-label="Task list summary">
            {summaryItems.map(({ key, label, icon: Icon }) => (
              <div key={key} className={`summary-row summary-${key}`}>
                <span className="summary-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span>{label}</span>
                <strong>{summary[key]}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer" aria-live="polite">
          <span className={`runtime-pill source-${apiNotice.source}`}>
            {apiNotice.source === "api" ? "Local API" : "Demo data"}
          </span>
          <p className="runtime-note">{apiNotice.warning || "Node ESM HTTP API is responding."}</p>
          <button
            type="button"
            className="sidebar-refresh"
            onClick={() => void refreshDashboard()}
            disabled={isLoading}
          >
            <RefreshCw aria-hidden="true" size={14} />
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </aside>

      <main className="app-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">Task operations</p>
            <h1>Dashboard</h1>
          </div>
          <div className="content-actions">
            {isLoading && <span className="loading-pill">Loading</span>}
          </div>
        </header>

        <TaskFilters filters={filters} onChange={setFilters} />

        <section className="workspace-grid">
          <section className="panel task-panel" aria-label="Overall task list">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Queue</p>
                <h2>Tasks</h2>
              </div>
              <span className="section-count">{tasks.length}</span>
            </div>
            <TaskList tasks={tasks} selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} />
          </section>

          <TaskDetail
            task={taskDetail}
            canMutate={canMutate}
            isBusy={isMutating}
            onClaim={claimSelectedTask}
            onDispatch={dispatchSelectedTask}
          />

          <TaskForm
            mode={formMode}
            value={draft}
            projectRoot={projectRoot.trim()}
            canSubmit={canSubmit}
            isBusy={isMutating}
            onModeChange={handleFormModeChange}
            onChange={setDraft}
            onSubmit={submitTaskForm}
          />
        </section>

        <SessionSummary sessions={sessions} />
      </main>
    </div>
  );
}
