import { useEffect, useMemo, useState } from "react";

import { agentDeskApi } from "./api/client";
import { validateProjectRoot } from "./api/projectRoot";
import { applySubtaskRows } from "./api/subtaskMarkdown";
import type {
  AgentDeskTask,
  AgentDeskTaskDetail,
  ApiResult,
  ApiSource,
  SubtaskRow,
  TaskFilters as TaskFiltersValue,
  TaskListSummary,
  TaskMutationInput,
} from "./api/types";
import { TaskForm } from "./components/TaskForm";
import { TaskWorkspace } from "./components/TaskWorkspace";
import { WorkspaceNav } from "./components/WorkspaceNav";
import type { DispatchParams } from "./components/DispatchPanel";
import type { ComposerLaunchParams, WorkspaceProject, WorkspaceProjectGroup, WorkspaceNavTask } from "./api/types";
import "./styles/app.css";
import '@uiw/react-md-editor/markdown-editor.css';

const defaultFilters: TaskFiltersValue = {
  range: "month",
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

function readInitialProjectRoot(): string {
  // The app always opens on the user-level task view (no project focused). We intentionally do
  // NOT restore the last-selected project from localStorage so `npm run dev:all` (run from the
  // user root, no --project) lands on the user view every time.
  return "";
}

function createBlankDraft(projectRoot: string, isPortfolioMode: boolean): TaskMutationInput {
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
    return { source: "mock", warning: fallback.warning };
  }
  return { source: "api" };
}

// Build workspace groups from flat task list
function buildWorkspaceGroups(allTasks: AgentDeskTask[]): WorkspaceProjectGroup[] {
  const projectMap = new Map<string, { projectRoot: string; shortName: string; tasks: AgentDeskTask[] }>();

  // The user-level group always exists and sits first — it's the default landing view.
  projectMap.set("__user__", { projectRoot: "", shortName: "我的任务", tasks: [] });

  for (const task of allTasks) {
    if (task.scope === "user" || !task.projectRoot) {
      const key = "__user__";
      if (!projectMap.has(key)) {
        projectMap.set(key, { projectRoot: "", shortName: "我的任务", tasks: [] });
      }
      projectMap.get(key)!.tasks.push(task);
    } else {
      const key = task.projectRoot;
      if (!projectMap.has(key)) {
        const shortName = task.projectRoot.split(/[\\/]/).pop() || task.projectRoot;
        projectMap.set(key, { projectRoot: key, shortName, tasks: [] });
      }
      projectMap.get(key)!.tasks.push(task);
    }
  }

  const groups: WorkspaceProjectGroup[] = [];

  for (const [key, entry] of projectMap.entries()) {
    const sortedTasks = [...entry.tasks].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    const navTasks: WorkspaceNavTask[] = sortedTasks.map((t) => ({
      taskId: t.taskId,
      title: t.title,
      status: t.status,
      priority: t.priority,
      updatedAt: t.updatedAt,
      claimedBy: t.claimedBy,
      subtaskProgress: t.subtaskCount > 0 ? Math.round((t.completedSubtasks / t.subtaskCount) * 100) : 0,
      hasActiveSession: !!t.activeSessionId,
    }));

    const lastUpdated = sortedTasks[0]?.updatedAt || new Date().toISOString();

    groups.push({
      project: {
        projectRoot: entry.projectRoot,
        shortName: entry.shortName,
        taskCount: entry.tasks.length,
        lastUpdatedAt: lastUpdated,
      },
      tasks: navTasks,
      defaultExpanded: key === "__user__",
    });
  }

  // Sort: user tasks first, then by most recent activity
  return groups.sort((a, b) => {
    if (a.project.projectRoot === "") return -1;
    if (b.project.projectRoot === "") return 1;
    return new Date(b.project.lastUpdatedAt).getTime() - new Date(a.project.lastUpdatedAt).getTime();
  });
}

export default function App() {
  const [projectRoot, setProjectRoot] = useState(readInitialProjectRoot);
  const [filters] = useState<TaskFiltersValue>(defaultFilters);
  const [tasks, setTasks] = useState<AgentDeskTask[]>([]);
  const [_summary, setSummary] = useState<TaskListSummary>(emptySummary);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [taskDetail, setTaskDetail] = useState<AgentDeskTaskDetail | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [draft, setDraft] = useState<TaskMutationInput>(() => createBlankDraft(projectRoot.trim(), !projectRoot.trim()));
  const [apiNotice, setApiNotice] = useState<{ source: ApiSource; warning?: string }>({ source: "mock" });
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [navSearchQuery, setNavSearchQuery] = useState("");
  const [projectDiscoveryItems, setProjectDiscoveryItems] = useState<AgentDeskTask[]>([]);

  const trimmedProjectRoot = projectRoot.trim();
  const isPortfolioMode = !trimmedProjectRoot;
  const focusedProjectRoot = trimmedProjectRoot;

  const canMutate = !isMutating && (!taskDetail || taskDetail.scope === "user" || validateProjectRoot(projectRoot).valid);
  // For project-scoped drafts, accept either the form's own projectRoot (portfolio picker) or the ambient one.
  const draftProjectRootValid = validateProjectRoot(draft.projectRoot?.trim() || projectRoot).valid;
  const canSubmit = !isMutating
    && draft.title.trim().length > 0
    && draft.brief.trim().length > 0
    && (draft.scope === "user" || draftProjectRootValid)
    && (formMode != null || Boolean(selectedTaskId));

  // Keep the create-form draft's projectRoot in sync with the focused project.
  // (We deliberately do NOT persist the focused project; the app always opens on the user view.)
  useEffect(() => {
    setDraft((current) => current.scope === "project"
      ? { ...current, projectRoot: projectRoot.trim(), taskType: current.taskType || "coding" }
      : current);
  }, [projectRoot]);

  // Load dashboard data
  useEffect(() => {
    let isActive = true;

    async function loadDashboard() {
      setIsLoading(true);
      const effectiveProjectRootForApi = isPortfolioMode ? "" : focusedProjectRoot;
      // In the user view, fetch only user-scoped tasks (and skip project backfill) via scope=user.
      const [taskResult] = await Promise.all([
        agentDeskApi.listTasks(
          effectiveProjectRootForApi,
          filters,
          isPortfolioMode ? { scope: "user" } : {},
        ),
      ]);

      if (!isActive) return;

      setTasks(taskResult.data.items);
      setSummary(taskResult.data.summary);
      setApiNotice(combineNotice([taskResult]));

      setSelectedTaskId((current) => {
        if (current && taskResult.data.items.some((task) => task.taskId === current)) {
          return current;
        }
        return undefined;
      });

      // In portfolio mode, also fetch discovery items for the sidebar project list
      if (isPortfolioMode) {
        const discoveryFilters = { ...filters, range: undefined as any };
        try {
          const discoveryResult = await agentDeskApi.listTasks("", discoveryFilters);
          if (isActive) setProjectDiscoveryItems(discoveryResult.data.items);
        } catch {
          if (isActive) setProjectDiscoveryItems(taskResult.data.items);
        }
      } else {
        if (isActive) setProjectDiscoveryItems([]);
      }

      setIsLoading(false);
    }

    void loadDashboard().catch((error) => {
      if (!isActive) return;
      setApiNotice({ source: "mock", warning: error instanceof Error ? error.message : "Dashboard load failed." });
      setIsLoading(false);
    });

    return () => { isActive = false; };
  }, [filters, projectRoot]);

  // Load task detail when selected
  useEffect(() => {
    let isActive = true;

    async function loadTaskDetail() {
      if (!selectedTaskId) {
        setTaskDetail(null);
        return;
      }
      const effectiveProjectRootForApi = isPortfolioMode ? "" : focusedProjectRoot;
      const result = await agentDeskApi.getTask(effectiveProjectRootForApi || "", selectedTaskId);

      if (!isActive) return;

      setTaskDetail(result.data);
      setApiNotice((current) => result.source === "mock" ? { source: "mock", warning: result.warning } : current);

      if (formMode === "edit") {
        setDraft(taskToDraft(result.data));
      }
    }

    void loadTaskDetail().catch((error) => {
      if (!isActive) return;
      setTaskDetail(null);
      setApiNotice({ source: "mock", warning: error instanceof Error ? error.message : "Task detail failed." });
    });

    return () => { isActive = false; };
  }, [formMode, projectRoot, selectedTaskId]);

  async function refreshDashboard() {
    const effectiveProjectRootForApi = isPortfolioMode ? "" : focusedProjectRoot;
    const [taskResult] = await Promise.all([
      agentDeskApi.listTasks(
        effectiveProjectRootForApi,
        filters,
        isPortfolioMode ? { scope: "user" } : {},
      ),
    ]);

    setTasks(taskResult.data.items);
    setSummary(taskResult.data.summary);
    setApiNotice(combineNotice([taskResult]));

    if (isPortfolioMode) {
      const discoveryFilters = { ...filters, range: undefined as any };
      try {
        const discoveryResult = await agentDeskApi.listTasks("", discoveryFilters);
        setProjectDiscoveryItems(discoveryResult.data.items);
      } catch {
        setProjectDiscoveryItems(taskResult.data.items);
      }
    } else {
      setProjectDiscoveryItems([]);
    }
  }

  // Handle selecting a project in the sidebar
  function handleSelectProject(projectRootValue: string) {
    setProjectRoot(projectRootValue);
    setSelectedTaskId(undefined);
    setTaskDetail(null);
  }

  // Handle selecting a task from the task list
  function handleSelectTask(taskId: string) {
    setSelectedTaskId(taskId);
  }

  // Go back to task list from detail view
  function handleBackToProjects() {
    setSelectedTaskId(undefined);
    setTaskDetail(null);
  }

  // Composer send handler
  async function handleComposerSend(
    text: string,
    _launchParams: ComposerLaunchParams,
    action: "append" | "new-task"
  ) {
    if (!text.trim()) return;

    if (action === "new-task" || !taskDetail) {
      const newDraft: TaskMutationInput = {
        ...createBlankDraft(projectRoot.trim(), isPortfolioMode),
        title: text.length > 60 ? text.slice(0, 57) + "..." : text,
        brief: text,
        status: "ready",
      };
      setDraft(newDraft);
      setFormMode("create");
      return;
    }

    const currentBrief = taskDetail.brief || taskDetail.markdown || "";
    const newBrief = currentBrief.trim()
      ? `${currentBrief.trim()}\n\n### 来自 Web Composer (${new Date().toLocaleString()})\n${text}`
      : text;

    setIsMutating(true);
    try {
      const result = await agentDeskApi.updateTask(taskDetail.taskId, {
        ...taskToDraft(taskDetail),
        brief: newBrief,
      });
      setTaskDetail(result.data);
      setApiNotice({ source: result.source, warning: result.warning });
      await refreshDashboard();
    } finally {
      setIsMutating(false);
    }
  }

  // Inline brief update
  async function handleInlineBriefUpdate(newBrief: string) {
    if (!taskDetail) return;
    setIsMutating(true);
    try {
      const result = await agentDeskApi.updateTask(taskDetail.taskId, {
        ...taskToDraft(taskDetail),
        brief: newBrief,
      });
      setTaskDetail(result.data);
      setDraft(taskToDraft(result.data));
      setApiNotice({ source: result.source, warning: result.warning });
      await refreshDashboard();
    } finally {
      setIsMutating(false);
    }
  }

  // Delete task
  async function handleDeleteTask(taskId: string) {
    setIsMutating(true);
    try {
      await agentDeskApi.deleteTask(taskId);
      if (selectedTaskId === taskId) {
        setSelectedTaskId(undefined);
        setTaskDetail(null);
      }
      await refreshDashboard();
    } catch (error) {
      setApiNotice({ source: "mock", warning: error instanceof Error ? error.message : "Delete failed." });
    } finally {
      setIsMutating(false);
    }
  }

  // Import project from Finder
  async function handleOpenFinderForImport() {
    try {
      if (!('showDirectoryPicker' in window)) {
        alert('当前浏览器不支持原生目录选择，请使用路径输入方式或升级浏览器。');
        return;
      }

      setIsImporting(true);
      const dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
      const projectName = dirHandle.name;

      const guessedPaths = [
        `/Users/yanzzp/Documents/CodeProjects/${projectName}`,
        `/Users/yanzzp/work/${projectName}`,
        `/Users/yanzzp/Desktop/${projectName}`,
        `/Users/yanzzp/${projectName}`,
      ];

      let imported = false;

      for (const guessed of guessedPaths) {
        try {
          const result = await agentDeskApi.importProjectTasks(guessed);
          if (result.data?.ok && result.data.importedCount > 0) {
            await refreshDashboard();
            if (isPortfolioMode) {
              const importedProjectRoot = guessed;
              setProjectDiscoveryItems((prev) => {
                const alreadyPresent = prev.some(t => t.projectRoot === importedProjectRoot);
                if (alreadyPresent) return prev;
                const synthetic: AgentDeskTask = {
                  taskId: `import-${Date.now()}`,
                  title: `${projectName} (imported)`,
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
            }
            alert(`成功从 Finder 选中 "${projectName}" 导入 ${result.data.importedCount} 个任务！`);
            imported = true;
            break;
          }
        } catch { /* skip */ }
      }

      if (!imported) {
        alert(
          `已通过 Finder 选中 "${projectName}"，但自动猜测路径未找到任务。\n` +
          `常见尝试路径：\n${guessedPaths.join('\n')}\n\n` +
          `你可以在终端 cd 到该项目后使用 CLI 命令导入，或手动提供准确路径。`
        );
      }
    } catch (err: any) {
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
      setFormMode(null);
      return;
    }
    setFormMode(mode);
    if (mode === "create") {
      const isAlreadyCreating = formMode === "create";
      if (isAlreadyCreating) {
        setDraft(createBlankDraft(projectRoot.trim(), isPortfolioMode));
      } else {
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
    if (!canSubmit) return;
    setIsMutating(true);

    // In portfolio mode the form's project picker drives draft.projectRoot; in focus mode the
    // ambient projectRoot is used. Either way a project-scoped task must carry a projectRoot.
    const resolvedProjectRoot = draft.projectRoot?.trim() || projectRoot.trim();
    const input: TaskMutationInput = {
      ...draft,
      projectRoot: draft.scope === "project" ? resolvedProjectRoot : "",
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
    setFormMode(null);
    setDraft(taskToDraft(result.data));
    await refreshDashboard();
    setIsMutating(false);
  }

  async function claimSelectedTask() {
    if (!taskDetail || !canMutate) return;
    setIsMutating(true);
    const result = await agentDeskApi.claimTask(taskDetail.taskId, {
      projectRoot: taskDetail.projectRoot || projectRoot.trim(),
      assignee: filters.assignee.trim() || "codex-ui",
      sessionId: `ui-${Date.now()}`,
    });
    setTaskDetail(result.data);
    if (formMode === "edit") setDraft(taskToDraft(result.data));
    setApiNotice({ source: result.source, warning: result.warning });
    await refreshDashboard();
    setIsMutating(false);
  }

  async function dispatchSelectedTask(params: DispatchParams) {
    if (!taskDetail || !canMutate) return;
    setIsMutating(true);
    const result = await agentDeskApi.dispatchTask(taskDetail.taskId, {
      projectRoot: taskDetail.projectRoot || projectRoot.trim(),
      model: params.model,
      reasoning: params.reasoning,
      serviceTier: "fast",
      parallel: params.parallel,
      launchBatchSize: 6,
    });
    setTaskDetail(result.data);
    if (formMode === "edit") setDraft(taskToDraft(result.data));
    setApiNotice({ source: result.source, warning: result.warning });
    await refreshDashboard();
    setIsMutating(false);
  }

  // Stage 2: AI-assisted subtask breakdown (project-scoped tasks). Returns proposed rows.
  async function handleAiBreakdown(): Promise<SubtaskRow[]> {
    if (!taskDetail) return [];
    const result = await agentDeskApi.breakdownTask(taskDetail.taskId, {});
    setApiNotice({ source: result.source, warning: result.warning });
    return result.data.subtasks;
  }

  // Persist edited subtask rows back into the task markdown (preserving non-subtask content).
  async function handleSaveSubtasks(rows: SubtaskRow[]) {
    if (!taskDetail) return;
    const nextMarkdown = applySubtaskRows(taskDetail.markdown || taskDetail.brief || "", rows);
    setIsMutating(true);
    try {
      const result = await agentDeskApi.updateTask(taskDetail.taskId, {
        ...taskToDraft(taskDetail),
        brief: nextMarkdown,
      });
      setTaskDetail(result.data);
      setDraft(taskToDraft(result.data));
      setApiNotice({ source: result.source, warning: result.warning });
      await refreshDashboard();
    } finally {
      setIsMutating(false);
    }
  }

  // Compute workspace groups for sidebar
  const workspaceGroups = useMemo(() => {
    const source = isPortfolioMode
      ? (projectDiscoveryItems.length > 0 ? projectDiscoveryItems : tasks)
      : tasks;
    let groups = buildWorkspaceGroups(source);

    // In focus mode, inject the focused project if it's not yet in groups
    if (!isPortfolioMode && focusedProjectRoot) {
      const alreadyHasCurrent = groups.some(g => g.project.projectRoot === focusedProjectRoot);
      if (!alreadyHasCurrent) {
        const shortName = focusedProjectRoot.split(/[\\/]/).pop() || focusedProjectRoot;
        groups = [
          ...groups,
          {
            project: {
              projectRoot: focusedProjectRoot,
              shortName,
              taskCount: 0,
              lastUpdatedAt: new Date().toISOString(),
            },
            tasks: [],
            defaultExpanded: true,
          },
        ];
      }
    }

    return groups;
  }, [tasks, projectDiscoveryItems, isPortfolioMode, focusedProjectRoot]);

  // Known projects (excluding the user "My Tasks" pseudo-group) for the create-form project picker.
  const knownProjects = useMemo<WorkspaceProject[]>(
    () => workspaceGroups
      .filter((g) => g.project.projectRoot)
      .map((g) => g.project),
    [workspaceGroups],
  );

  // Get the header title: the focused project name, or the user-level view label.
  const selectedProjectName = useMemo(() => {
    const group = workspaceGroups.find(g => g.project.projectRoot === focusedProjectRoot);
    if (group) return group.project.shortName;
    if (focusedProjectRoot) return focusedProjectRoot.split(/[\\/]/).pop() || focusedProjectRoot;
    return "我的任务";
  }, [workspaceGroups, focusedProjectRoot]);

  // Tasks shown in the center panel.
  // - User view (portfolio mode): only user-scoped tasks (cross-project planning / personal todos).
  //   Project tasks remain reachable from the sidebar.
  // - Project view (focus mode): tasks belonging to the focused project.
  const projectTasks = useMemo(() => {
    if (isPortfolioMode) {
      return tasks.filter((t) => t.scope === "user" || !t.projectRoot);
    }
    return tasks.filter((t) =>
      t.projectRoot === focusedProjectRoot || (t.scope === "user" && !focusedProjectRoot)
    );
  }, [tasks, isPortfolioMode, focusedProjectRoot]);

  return (
    <div className="workspace-shell">
      {/* Left: Project sidebar */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">AD</span>
          <div className="brand-text">
            <strong>AgentDesk</strong>
            <span>Beta</span>
          </div>
        </div>

        <WorkspaceNav
          groups={workspaceGroups}
          selectedProjectRoot={focusedProjectRoot}
          onSelectProject={handleSelectProject}
          searchQuery={navSearchQuery}
          onSearchChange={setNavSearchQuery}
          onRefresh={() => void refreshDashboard()}
          isLoading={isLoading}
          onImportProject={handleOpenFinderForImport}
          isImporting={isImporting}
          onNewTask={() => handleFormModeChange("create")}
        />

        <div className="sidebar-footer" aria-live="polite">
          <span className={`runtime-pill source-${apiNotice.source}`}>
            {apiNotice.source === "api" ? "Local API" : "Demo data"}
          </span>
        </div>
      </aside>

      {/* Center: Task workspace */}
      <main className="task-workspace-main">
        <TaskWorkspace
          tasks={projectTasks}
          taskDetail={taskDetail}
          selectedProjectRoot={focusedProjectRoot}
          selectedProjectName={selectedProjectName}
          canMutate={canMutate}
          isBusy={isMutating}
          onClaim={claimSelectedTask}
          onDispatch={dispatchSelectedTask}
          onUpdateBrief={handleInlineBriefUpdate}
          onAiBreakdown={handleAiBreakdown}
          onSaveSubtasks={handleSaveSubtasks}
          onComposerSend={handleComposerSend}
          onSelectTask={handleSelectTask}
          onDeleteTask={handleDeleteTask}
          onNewTask={() => handleFormModeChange("create")}
          onBackToProjects={handleBackToProjects}
        />

        {/* Create/edit task modal */}
        {formMode === "create" && (
          <div className="modal-backdrop" onClick={() => handleFormModeChange(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                className="modal-close"
                onClick={() => handleFormModeChange(null)}
                aria-label="Close task editor"
              >
                x
              </button>
              <TaskForm
                mode={formMode}
                value={draft}
                projectRoot={projectRoot.trim()}
                isPortfolioMode={isPortfolioMode}
                projects={knownProjects}
                canSubmit={canSubmit}
                isBusy={isMutating}
                onModeChange={(mode) => handleFormModeChange(mode)}
                onChange={setDraft}
                onSubmit={submitTaskForm}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
