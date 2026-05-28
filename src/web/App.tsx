import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
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
import { TaskForm } from "./components/TaskForm";
import { TaskWorkspace } from "./components/TaskWorkspace";
import { WorkspaceNav } from "./components/WorkspaceNav";
import type { ComposerLaunchParams, WorkspaceProjectGroup, WorkspaceNavTask } from "./api/types";
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

// ============================================================
// Workspace 树分组辅助函数（前端聚合，零后端依赖）
// 将扁平 AgentDeskTask 列表转为 WorkspaceProjectGroup[]，供 WorkspaceNav 使用
// ============================================================
function buildWorkspaceGroups(allTasks: AgentDeskTask[]): WorkspaceProjectGroup[] {
  const projectMap = new Map<string, { projectRoot: string; shortName: string; tasks: AgentDeskTask[] }>();

  for (const task of allTasks) {
    if (task.scope === "user" || !task.projectRoot) {
      // 用户级任务归入特殊 key
      const key = "__user__";
      if (!projectMap.has(key)) {
        projectMap.set(key, { projectRoot: "", shortName: "User Tasks", tasks: [] });
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

  // User Tasks 永远排在最前，其余按最近活动排序
  return groups.sort((a, b) => {
    if (a.project.projectRoot === "") return -1;
    if (b.project.projectRoot === "") return 1;
    return new Date(b.project.lastUpdatedAt).getTime() - new Date(a.project.lastUpdatedAt).getTime();
  });
}

export default function App() {
  const [projectRoot, setProjectRoot] = useState(readInitialProjectRoot);
  const [filters, setFilters] = useState<TaskFiltersValue>(defaultFilters);
  const [tasks, setTasks] = useState<AgentDeskTask[]>([]);
  const [_summary, setSummary] = useState<TaskListSummary>(emptySummary);
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

  // === Workspace 树导航新状态（类 Codex / Claude Code 模式）===
  const [navSearchQuery, setNavSearchQuery] = useState("");
  const [expandedProjectRoots, setExpandedProjectRoots] = useState<Set<string>>(new Set(["__user__"]));
  const [showRightOutput, setShowRightOutput] = useState(true); // 右侧输出面板（MVP 可折叠）

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

  // _knownProjects 仅为兼容旧发现逻辑保留，当前 WorkspaceNav 使用 workspaceGroups 替代
  const _knownProjects = useMemo(() => {
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
  void _knownProjects;

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

      const effectiveProjectRootForApi = isPortfolioMode ? "" : focusedProjectRoot;

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
          const discoveryResult = await agentDeskApi.listTasks("", discoveryFilters);
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

      const effectiveProjectRootForApi = isPortfolioMode ? "" : focusedProjectRoot;
      const result = await agentDeskApi.getTask(effectiveProjectRootForApi || "", selectedTaskId);

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
    const effectiveProjectRootForApi = isPortfolioMode ? "" : focusedProjectRoot;

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
        const discoveryResult = await agentDeskApi.listTasks("", discoveryFilters);
        setProjectDiscoveryItems(discoveryResult.data.items);
      } catch {
        setProjectDiscoveryItems(taskResult.data.items);
      }
    } else {
      setProjectDiscoveryItems([]);
    }
  }

  // === Workspace 树交互处理器 ===
  function toggleProject(root: string) {
    setExpandedProjectRoots((prev) => {
      const next = new Set(prev);
      if (next.has(root)) {
        next.delete(root);
      } else {
        next.add(root);
      }
      return next;
    });
  }

  function handleSelectTask(taskId: string, projectRoot?: string) {
    setSelectedTaskId(taskId);
    // 如果传入了 projectRoot，自动切换聚焦（符合用户“点任务即切换项目”习惯）
    if (projectRoot && projectRoot !== focusedProjectRoot) {
      setProjectRoot(projectRoot);
    }
    // 自动展开对应项目
    if (projectRoot) {
      setExpandedProjectRoots((prev) => new Set(prev).add(projectRoot));
    }
  }

  // Composer 发送处理（追加到当前任务 或 创建新任务）
  async function handleComposerSend(
    text: string,
    launchParams: ComposerLaunchParams,
    action: "append" | "new-task"
  ) {
    if (!text.trim()) return;

    if (action === "new-task" || !taskDetail) {
      // 创建新任务（复用现有草稿 + create 逻辑）
      const newDraft: TaskMutationInput = {
        ...createBlankDraft(projectRoot.trim(), isPortfolioMode),
        title: text.length > 60 ? text.slice(0, 57) + "..." : text,
        brief: text,
        status: "ready",
      };
      setDraft(newDraft);
      setFormMode("create");
      // 实际提交留给用户在弹窗确认（或未来可一键直达 dispatch）
      return;
    }

    // 追加到当前任务的 brief
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

      // 可选：发送后立即 dispatch（符合 agent 模式习惯）
      // 这里先不自动 dispatch，给用户明确控制权
    } finally {
      setIsMutating(false);
    }
  }

  // 内联更新 task brief（TaskWorkspace 编辑器保存）
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
          // 诊断用，静默
          void e;
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
      void err; // 显式消费，避免 noUnusedLocals
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

  // 计算 Workspace 树数据（基于当前 tasks）
  const workspaceGroups = useMemo(() => {
    const source = isPortfolioMode ? projectDiscoveryItems.length > 0 ? projectDiscoveryItems : tasks : tasks;
    return buildWorkspaceGroups(source);
  }, [tasks, projectDiscoveryItems, isPortfolioMode]);

  return (
    <div className="workspace-shell">
      {/* 左侧：项目-任务树导航（核心新体验） */}
      <aside className="app-sidebar workspace-nav-shell" aria-label="项目与任务导航">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">AD</span>
          <div className="brand-text">
            <strong>AgentDesk</strong>
            <span>Beta · Agent Workspace</span>
          </div>
        </div>

        {/* 新的 WorkspaceNav 树组件 */}
        <WorkspaceNav
          groups={workspaceGroups}
          expandedRoots={expandedProjectRoots}
          onToggleProject={toggleProject}
          searchQuery={navSearchQuery}
          onSearchChange={setNavSearchQuery}
          selectedTaskId={selectedTaskId}
          onSelectTask={handleSelectTask}
          onRefresh={() => void refreshDashboard()}
          isLoading={isLoading}
          userTasksExpanded={expandedProjectRoots.has("__user__")}
          onToggleUserTasks={() => toggleProject("__user__")}
        />

        {/* 保留 Finder 导入入口（符合用户已有习惯） */}
        {isPortfolioMode && (
          <div className="sidebar-section import-section" style={{ padding: "0 12px 12px" }}>
            <button
              type="button"
              className="primary-action"
              disabled={isImporting}
              onClick={() => void handleOpenFinderForImport()}
              style={{ width: "100%", fontSize: 12.5 }}
            >
              {isImporting ? "导入中..." : "从 Finder 导入项目"}
            </button>
          </div>
        )}

        <div className="sidebar-footer" aria-live="polite" style={{ marginTop: "auto" }}>
          <span className={`runtime-pill source-${apiNotice.source}`}>
            {apiNotice.source === "api" ? "Local API" : "Demo data"}
          </span>
          <p className="runtime-note">{apiNotice.warning || "Node ESM HTTP API"}</p>
          <button
            type="button"
            className="sidebar-refresh"
            onClick={() => void refreshDashboard()}
            disabled={isLoading}
          >
            <RefreshCw aria-hidden="true" size={14} />
            {isLoading ? "刷新中" : "刷新"}
          </button>
        </div>
      </aside>

      {/* 中央：专注任务工作区（取代旧的 list + detail 网格） */}
      <main className="task-workspace-main">
        {/* 极简顶部工具栏（保留少量全局操作） */}
        <div className="workspace-topbar">
          <div className="topbar-left">
            <span className="topbar-title">
              {isPortfolioMode ? "所有项目" : focusedProjectRoot.split(/[\\/]/).pop() || "当前项目"}
            </span>
            {isLoading && <span className="loading-pill">加载中</span>}
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="ghost-action"
              onClick={() => handleFormModeChange("create")}
            >
              + 新建任务
            </button>
            <button
              type="button"
              className="ghost-action"
              onClick={() => setShowRightOutput(v => !v)}
            >
              {showRightOutput ? "隐藏输出" : "显示输出"}
            </button>
          </div>
        </div>

        <TaskWorkspace
          task={taskDetail}
          canMutate={canMutate}
          isBusy={isMutating}
          onClaim={claimSelectedTask}
          onDispatch={dispatchSelectedTask}
          onUpdateBrief={handleInlineBriefUpdate}
          onComposerSend={handleComposerSend}
          isPortfolioMode={isPortfolioMode}
        />

        {/* 旧的创建/编辑弹窗保留作为后备（不破坏已有流程） */}
        {formMode === "create" && (
          <div className="modal-backdrop" onClick={() => handleFormModeChange(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
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
      </main>

      {/* 右侧：输出 / Artifacts 面板（可折叠占位，匹配参考图） */}
      {showRightOutput && (
        <aside className="workspace-output" aria-label="输出与产物">
          <h3>输出面板（Beta）</h3>
          <div style={{ opacity: 0.7, fontSize: 12, lineHeight: 1.5 }}>
            最近一次 Dispatch 的 subagent 摘要、文件变更和 token 消耗将在后续迭代中接入。<br /><br />
            当前版本重点优化左侧项目-任务树导航体验。
          </div>

          {sessions.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: "var(--workspace-muted)", marginBottom: 6 }}>最近会话</div>
              <SessionSummary sessions={sessions} />
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
