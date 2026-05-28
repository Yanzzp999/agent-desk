import { useEffect, useMemo, useRef, useState } from "react";
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
import '@uiw/react-md-editor/markdown-editor.css';

const PROJECT_ROOT_STORAGE_KEY = "agentdesk.web.projectRoot";

const defaultFilters: TaskFiltersValue = {
  range: "day",   // 按批准计划改为默认 Day，贴近「每天的任务列表」使用习惯
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

function createBlankDraft(projectRoot: string, isPortfolioMode: boolean): TaskMutationInput {
  // 在用户根目录模式（Portfolio）下，默认更倾向创建 User 级任务
  const hasProjectRoot = projectRoot.trim().length > 0;
  const preferUserScope = isPortfolioMode || !hasProjectRoot;

  return {
    projectRoot: hasProjectRoot ? projectRoot : "",
    scope: preferUserScope ? "user" : "project",
    taskType: preferUserScope ? "general" : "coding",
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
  // formMode is null by default so that refreshing the page does NOT auto-open the create task modal.
  // The modal should only appear when the user explicitly clicks "+ New".
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [draft, setDraft] = useState<TaskMutationInput>(() => createBlankDraft(projectRoot.trim(), !projectRoot.trim()));
  const [apiNotice, setApiNotice] = useState<{ source: ApiSource; warning?: string }>({ source: "mock" });
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Separate list used only to populate the "My Projects" sidebar in Portfolio mode.
  // We fetch this with a wider range ("month") so that after you import a project (e.g. AgentDesk),
  // it appears in the sidebar and you can click it to switch/focus, regardless of your current
  // list filters (Day/Week + status + assignee).
  const [projectDiscoveryItems, setProjectDiscoveryItems] = useState<AgentDeskTask[]>([]);

  // === 两种视图模式定义（用户根目录模式 vs 单项目聚焦模式）===
  const trimmedProjectRoot = projectRoot.trim();
  const isPortfolioMode = !trimmedProjectRoot;   // 用户根目录模式（Portfolio）
  const focusedProjectRoot = trimmedProjectRoot; // 当前聚焦的项目（为空则为 Portfolio 模式）



  // Project list for the sidebar.
  // In Portfolio mode we use a separate broader discovery list (fetched with wider range)
  // so that the user can always see and switch to imported projects, regardless of the
  // current list filters (Day/Week + status + assignee).
  const sourceForKnownProjects = isPortfolioMode ? projectDiscoveryItems : tasks;

  const knownProjects = useMemo(() => {
    const map = new Map<string, { projectRoot: string; shortName: string; count: number }>();
    for (const t of sourceForKnownProjects) {
      if (t.scope === "project" && t.projectRoot) {
        const existing = map.get(t.projectRoot);
        if (existing) {
          existing.count += 1;
        } else {
          const shortName = t.projectRoot.split(/[\\/]/).pop() || t.projectRoot;
          map.set(t.projectRoot, { projectRoot: t.projectRoot, shortName, count: 1 });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.shortName.localeCompare(b.shortName));
  }, [sourceForKnownProjects]);

  const projectRootValidation = useMemo(() => validateProjectRoot(projectRoot), [projectRoot]);
  const canMutate = !isMutating && (!taskDetail || taskDetail.scope === "user" || projectRootValidation.valid);
  const canSubmit = !isMutating
    && draft.title.trim().length > 0
    && draft.brief.trim().length > 0
    && (draft.scope === "user" || projectRootValidation.valid)
    && (formMode != null || Boolean(selectedTaskId));

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

    // When the user focuses a specific project (enters focus mode),
    // automatically relax the time range filter and clear global filters
    // like assignee. This ensures that the project's imported or historical
    // tasks become visible.
    if (focusedProjectRoot) {
      const needsWiden = filters.range === "day";
      const needsClearAssignee = !!filters.assignee;

      if (needsWiden || needsClearAssignee) {
        setFilters(f => ({
          ...f,
          range: needsWiden ? "month" : f.range,
          assignee: needsClearAssignee ? "" : f.assignee,
        }));
      }
    }
  }, [projectRoot, isPortfolioMode, focusedProjectRoot]);

  useEffect(() => {
    let isActive = true;

    async function loadDashboard() {
      setIsLoading(true);

      const effectiveProjectRootForApi = isPortfolioMode ? undefined : focusedProjectRoot;

      const [taskResult, sessionResult] = await Promise.all([
        agentDeskApi.listTasks(effectiveProjectRootForApi, filters),
        agentDeskApi.listRecentSessions(effectiveProjectRootForApi, 6),
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

      // Same discovery logic as refreshDashboard for the project switcher in Portfolio mode
      if (isPortfolioMode) {
        const discoveryFilters = { ...filters, range: undefined as any };
        try {
          const discoveryResult = await agentDeskApi.listTasks(undefined, discoveryFilters);
          setProjectDiscoveryItems(discoveryResult.data.items);
        } catch {
          setProjectDiscoveryItems(taskResult.data.items);
        }
      } else {
        setProjectDiscoveryItems([]);
      }

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

      const effectiveProjectRootForApi = isPortfolioMode ? undefined : focusedProjectRoot;
      const result = await agentDeskApi.getTask(effectiveProjectRootForApi, selectedTaskId);

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
    const effectiveProjectRootForApi = isPortfolioMode ? undefined : focusedProjectRoot;

    const [taskResult, sessionResult] = await Promise.all([
      agentDeskApi.listTasks(effectiveProjectRootForApi, filters),
      agentDeskApi.listRecentSessions(effectiveProjectRootForApi, 6),
    ]);

    setTasks(taskResult.data.items);
    setSummary(taskResult.data.summary);
    setSessions(sessionResult.data);
    setApiNotice(combineNotice([taskResult, sessionResult]));

    // In Portfolio mode, also fetch a wider view just to populate the project switcher.
    // This ensures that after importing a project, it appears in "My Projects" even if
    // the user's current filters (e.g. "Day" + specific assignee) would hide its tasks
    // from the main list.
    if (isPortfolioMode) {
      // For project discovery in Portfolio, deliberately do NOT send range/period filters.
      // We want to surface all imported projects regardless of when their tasks were created.
      const discoveryFilters = { ...filters, range: undefined as any };
      try {
        const discoveryResult = await agentDeskApi.listTasks(undefined, discoveryFilters);
        setProjectDiscoveryItems(discoveryResult.data.items);
      } catch {
        setProjectDiscoveryItems(taskResult.data.items);
      }
    } else {
      setProjectDiscoveryItems([]);
    }
  }

  async function handleOpenFinderForImport() {
    try {
      if (!('showDirectoryPicker' in window)) {
        alert('当前浏览器不支持原生目录选择，请使用路径输入方式或升级浏览器。');
        return;
      }

      setIsImporting(true);

      // 使用现代 File System Access API，打开类似 Finder 的原生目录选择器
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'read',
      });

      const projectName = dirHandle.name;

      // 基于常见开发目录结构猜测完整路径（用户主要是这个机器上的 CodeProjects）
      // 如果导入失败，用户仍可在终端用真实路径配合 CLI 导入
      const guessedPaths = [
        `/Users/yanzzp/Documents/CodeProjects/${projectName}`,
        `/Users/yanzzp/work/${projectName}`,
        `/Users/yanzzp/Desktop/${projectName}`,
        `/Users/yanzzp/${projectName}`,
      ];

      let imported = false;
      let lastError = '';

      for (const guessed of guessedPaths) {
        try {
          const result = await agentDeskApi.importProjectTasks(guessed);
          if (result.data?.ok && result.data.importedCount > 0) {
            await refreshDashboard();

            // Optimistically surface the just-imported project in the sidebar immediately.
            // This makes the "import → see in My Projects → click to switch/focus" flow feel complete and logical,
            // even before the next full discovery query or if the current filters would hide its tasks.
            if (isPortfolioMode) {
              const importedProjectRoot = guessed; // the path we just successfully imported
              const shortName = projectName;

              setProjectDiscoveryItems((prev) => {
                const alreadyPresent = prev.some(t => t.projectRoot === importedProjectRoot);
                if (alreadyPresent) return prev;

                // Create a synthetic task entry so knownProjects can pick it up right away
                const synthetic: AgentDeskTask = {
                  taskId: `import-${Date.now()}`,
                  title: `${shortName} (imported)`,
                  brief: `Imported via Finder at ${new Date().toISOString()}`,
                  status: "ready",
                  priority: "normal",
                  scope: "project",
                  taskType: "general",
                  projectRoot: importedProjectRoot,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  tags: [],
                  subtaskCount: 0,
                  completedSubtasks: 0,
                  paths: { taskMd: "" },
                };
                return [...prev, synthetic];
              });

              // Widen the visible filter so the newly imported tasks have a chance to appear in the main list too.
              // This makes the "import → see the project + its tasks" experience feel complete.
              if (filters.range === "day") {
                setFilters((f) => ({ ...f, range: "month" }));
              }
            }

            alert(`成功从 Finder 选中 "${projectName}" 导入 ${result.data.importedCount} 个任务！`);
            imported = true;
            break;
          }
        } catch (e: any) {
          lastError = e?.message || String(e);
        }
      }

      if (!imported) {
        alert(
          `已通过 Finder 选中 "${projectName}"，但自动猜测路径未找到任务。\n` +
          `常见尝试路径：\n${guessedPaths.join('\n')}\n\n` +
          `你可以在终端 cd 到该项目后使用 CLI 命令导入，或手动提供准确路径。`
        );
      }
    } catch (err: any) {
      // 用户取消选择或权限问题
      if (err?.name !== 'AbortError') {
        console.error(err);
        alert('选择文件夹时出错：' + (err?.message || err));
      }
    } finally {
      setIsImporting(false);
    }
  }

  function handleFormModeChange(mode: "create" | "edit" | null) {
    if (mode === null) {
      // Just close the modal, keep the current draft for later
      setFormMode(null);
      return;
    }

    setFormMode(mode);

    if (mode === "create") {
      // Force a fresh draft when the user explicitly clicks the "New" button
      // inside the form (they want to start over). Otherwise keep draft for
      // close/reopen behavior.
      const isAlreadyCreating = formMode === "create";
      if (isAlreadyCreating) {
        // User clicked "New" while already creating → start completely fresh
        setDraft(createBlankDraft(projectRoot.trim(), isPortfolioMode));
      } else {
        // Opening the modal for create — preserve existing draft if any
        const hasExistingDraft = draft.title.trim() !== "" || draft.brief.trim() !== "";
        if (!hasExistingDraft) {
          setDraft(createBlankDraft(projectRoot.trim(), isPortfolioMode));
        }
      }
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

        {/* === 视图模式区分：用户根目录模式 vs 单项目聚焦模式 === */}
        <div className="sidebar-section">
          <p className="sidebar-label">
            {isPortfolioMode ? "Workspace (User Root)" : "Focus Project"}
          </p>

          {/* 在 Portfolio 模式下隐藏手动输入框，改为通过项目列表点击切换 */}
          {!isPortfolioMode && (
            <div className="project-root-control">
              <label className="field">
                <span>Current Focus</span>
                <div className="input-with-icon project-input">
                  <FolderGit2 aria-hidden="true" size={15} />
                  <input
                    value={projectRoot}
                    placeholder="/path/to/project"
                    onChange={(event) => setProjectRoot(event.target.value)}
                  />
                </div>
              </label>

              <div className="mode-hint">
                当前处于 <strong>单项目聚焦模式</strong>
                <button 
                  type="button" 
                  className="ghost-action tiny" 
                  onClick={() => setProjectRoot("")}
                >
                  返回用户根目录模式
                </button>
              </div>
            </div>
          )}

          {isPortfolioMode && (
            <div className="portfolio-mode-notice">
              <p className="small">点击左侧项目即可聚焦查看该项目任务</p>
            </div>
          )}
        </div>

        {/* My Projects 列表 - Portfolio 模式下的主要导航入口（点击即可聚焦） */}
        <div className="sidebar-section">
          <div className="sidebar-label-row">
            <p className="sidebar-label">
              {isPortfolioMode ? "My Projects" : "Other Projects"}
            </p>
          </div>

          <div className="project-list">
            {knownProjects.length > 0 ? (
              knownProjects.map((p) => {
                const isActive = p.projectRoot === focusedProjectRoot;
                return (
                  <button
                    key={p.projectRoot}
                    type="button"
                    className={`project-pill ${isActive ? "is-active" : ""}`}
                    onClick={() => {
                      setProjectRoot(p.projectRoot);
                      // When the user explicitly clicks to focus a project,
                      // immediately relax filters. This is the most reliable place
                      // to ensure the project's tasks become visible right away.
                      setFilters(f => ({
                        ...f,
                        range: f.range === "day" ? "month" : f.range,
                        assignee: "",
                      }));
                      // Force a refresh so the list updates with the new (wider) filters
                      // right after the user clicks the project.
                      setTimeout(() => {
                        // We can't call refreshDashboard directly here easily because of closure,
                        // but changing filters + projectRoot will trigger the effects.
                        // As a belt-and-suspenders, we can also directly refresh if needed.
                      }, 0);
                    }}
                    title={`点击聚焦到 ${p.projectRoot}`}
                  >
                    <FolderGit2 aria-hidden="true" size={13} />
                    <span>{p.shortName}</span>
                    <span className="project-count">{p.count}</span>
                  </button>
                );
              })
            ) : (
              <div className="empty-projects">
                {isPortfolioMode 
                  ? <>还没有导入任何项目。<br />点击上方的「从 Finder 选择项目导入任务」按钮来添加。</>
                  : "No other projects imported yet."}
              </div>
            )}

            <button
              type="button"
              className="project-pill project-all"
              onClick={() => setProjectRoot("")}
              title="返回用户根目录模式，查看所有项目 + 用户级任务"
            >
              {isPortfolioMode ? "显示全部（含用户级任务）" : "返回用户根目录模式"}
            </button>
          </div>
        </div>

        {/* Portfolio 模式下的导入项目任务 - 用 Finder 打开选择 */}
        {isPortfolioMode && (
          <div className="sidebar-section import-section">
            <button
              type="button"
              className="primary-action"
              disabled={isImporting}
              onClick={() => void handleOpenFinderForImport()}
            >
              {isImporting ? "导入中..." : "从 Finder 选择项目导入任务"}
            </button>
          </div>
        )}

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
            <h1>
              {isPortfolioMode ? "Portfolio Dashboard" : "Project Dashboard"}
            </h1>
            <p className="workspace-mode-subtitle">
              {isPortfolioMode 
                ? "跨项目任务总览（用户根目录）" 
                : `当前聚焦：${focusedProjectRoot}`}
            </p>
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
                <h2>Tasks</h2>
              </div>
              <div className="panel-actions">
                <span className="section-count">{tasks.length}</span>
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => handleFormModeChange("create")}
                >
                  + New
                </button>
              </div>
            </div>
            <TaskList 
              tasks={tasks} 
              selectedTaskId={selectedTaskId} 
              onSelect={setSelectedTaskId}
              isFocusedProject={!isPortfolioMode}
            />
          </section>

          <TaskDetail
            task={taskDetail}
            canMutate={canMutate}
            isBusy={isMutating}
            onClaim={claimSelectedTask}
            onDispatch={dispatchSelectedTask}
          />
        </section>

        {/* Task creation / editing is now contextual rather than permanently occupying screen real estate */}
        {formMode === "create" && (
          <div className="modal-backdrop" onClick={() => handleFormModeChange(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              {/* Close button */}
              <button
                type="button"
                className="modal-close"
                onClick={() => handleFormModeChange(null)}
                aria-label="Close task editor"
              >
                ×
              </button>

              <TaskForm
                mode={formMode}
                value={draft}
                projectRoot={projectRoot.trim()}
                isPortfolioMode={isPortfolioMode}
                canSubmit={canSubmit}
                isBusy={isMutating}
                onModeChange={(mode) => handleFormModeChange(mode)}
                onChange={setDraft}
                onSubmit={submitTaskForm}
              />
            </div>
          </div>
        )}

        <SessionSummary sessions={sessions} />
      </main>
    </div>
  );
}
