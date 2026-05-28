import { useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";

import type { WorkspaceProjectGroup, WorkspaceNavTask } from "../api/types";

interface WorkspaceNavProps {
  groups: WorkspaceProjectGroup[];
  expandedRoots: Set<string>;
  onToggleProject: (projectRoot: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedTaskId?: string;
  onSelectTask: (taskId: string, projectRoot?: string) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  /** 特殊处理：User Tasks 分区是否始终展开 */
  userTasksExpanded?: boolean;
  onToggleUserTasks?: () => void;
}

const USER_TASKS_KEY = "__user__";

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays}天`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function getStatusDotColor(status: WorkspaceNavTask["status"]): string {
  switch (status) {
    case "running":
      return "#0d8a5f";
    case "claimed":
      return "#b76e00";
    case "ready":
      return "#3563e9";
    case "succeeded":
      return "#4b29b8";
    case "blocked":
    case "failed":
      return "#c93030";
    default:
      return "#6b7393";
  }
}

export function WorkspaceNav({
  groups,
  expandedRoots,
  onToggleProject,
  searchQuery,
  onSearchChange,
  selectedTaskId,
  onSelectTask,
  onRefresh,
  isLoading,
  userTasksExpanded = true,
  onToggleUserTasks,
}: WorkspaceNavProps) {
  // 将 groups 分为 User Tasks + 普通项目
  const { userGroup, projectGroups } = useMemo(() => {
    const user = groups.find((g) => g.project.projectRoot === "" || g.project.shortName.toLowerCase().includes("user"));
    const projects = groups.filter((g) => g.project.projectRoot !== "" && !g.project.shortName.toLowerCase().includes("user"));
    return { userGroup: user, projectGroups: projects };
  }, [groups]);

  // 搜索过滤（仅过滤任务标题，不隐藏空项目）
  const filteredProjectGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projectGroups;

    return projectGroups
      .map((group) => ({
        ...group,
        tasks: group.tasks.filter((t) =>
          t.title.toLowerCase().includes(q) || (t.claimedBy || "").toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.tasks.length > 0 || g.project.shortName.toLowerCase().includes(q));
  }, [projectGroups, searchQuery]);

  const filteredUserTasks = useMemo(() => {
    if (!userGroup) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return userGroup.tasks;
    return userGroup.tasks.filter((t) =>
      t.title.toLowerCase().includes(q) || (t.claimedBy || "").toLowerCase().includes(q)
    );
  }, [userGroup, searchQuery]);

  function renderTaskRow(task: WorkspaceNavTask, projectRoot?: string) {
    const isSelected = selectedTaskId === task.taskId;
    return (
      <button
        key={task.taskId}
        type="button"
        className={`nav-task ${isSelected ? "is-selected" : ""}`}
        onClick={() => onSelectTask(task.taskId, projectRoot)}
        title={task.title}
      >
        <span
          className="nav-task-status"
          style={{ backgroundColor: getStatusDotColor(task.status) }}
          aria-hidden="true"
        />
        <span className="nav-task-title">{task.title}</span>
        <span className="nav-task-meta">
          {task.hasActiveSession && <span className="live-dot" aria-label="活跃会话" />}
          <span className="nav-task-time">{formatRelativeTime(task.updatedAt)}</span>
          {task.subtaskProgress > 0 && (
            <span className="nav-task-progress">{task.subtaskProgress}%</span>
          )}
        </span>
      </button>
    );
  }

  return (
    <div className="workspace-nav" aria-label="工作区导航">
      {/* 搜索 + 刷新 */}
      <div className="nav-toolbar">
        <div className="nav-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索任务或负责人..."
            aria-label="搜索任务"
          />
        </div>
        {onRefresh && (
          <button
            type="button"
            className="nav-refresh"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="刷新"
          >
            <RefreshCw size={14} className={isLoading ? "spin" : ""} />
          </button>
        )}
      </div>

      {/* User Tasks 分区（始终置顶） */}
      {userGroup && filteredUserTasks.length > 0 && (
        <div className="nav-section user-tasks">
          <button
            type="button"
            className="nav-section-header"
            aria-expanded={userTasksExpanded}
            onClick={onToggleUserTasks || (() => onToggleProject(USER_TASKS_KEY))}
          >
            <span className="nav-section-icon">
              <UserRound size={15} />
            </span>
            <span className="nav-section-title">User Tasks</span>
            <span className="nav-section-count">{filteredUserTasks.length}</span>
            <span className="nav-chevron" aria-hidden="true">
              {userTasksExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>

          {userTasksExpanded && (
            <div className="nav-task-list" role="list">
              {filteredUserTasks.slice(0, 8).map((task) => renderTaskRow(task))}
              {filteredUserTasks.length > 8 && (
                <div className="nav-more">+ {filteredUserTasks.length - 8} 个更多</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 项目分组树 */}
      <div className="nav-projects">
        {filteredProjectGroups.length === 0 && searchQuery && (
          <div className="nav-empty">没有匹配的任务</div>
        )}

        {filteredProjectGroups.map((group) => {
          const root = group.project.projectRoot;
          const isExpanded = expandedRoots.has(root);
          const visibleTasks = searchQuery ? group.tasks : group.tasks.slice(0, 6);

          return (
            <div key={root} className="nav-project">
              <button
                type="button"
                className="nav-section-header project-header"
                aria-expanded={isExpanded}
                onClick={() => onToggleProject(root)}
              >
                <span className="nav-section-icon">
                  <FolderGit2 size={15} />
                </span>
                <span className="nav-section-title" title={root}>
                  {group.project.shortName}
                </span>
                <span className="nav-section-count">{group.project.taskCount}</span>
                <span className="nav-chevron" aria-hidden="true">
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </button>

              {isExpanded && (
                <div className="nav-task-list" role="list">
                  {visibleTasks.length > 0 ? (
                    visibleTasks.map((task) => renderTaskRow(task, root))
                  ) : (
                    <div className="nav-empty-task">此项目暂无匹配任务</div>
                  )}
                  {!searchQuery && group.tasks.length > 6 && (
                    <div className="nav-more">+ {group.tasks.length - 6} 个任务（调整过滤器查看全部）</div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filteredProjectGroups.length === 0 && !searchQuery && (
          <div className="nav-empty">还没有导入项目<br />使用下方按钮从 Finder 导入</div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="nav-footer-hint">
        点击项目展开任务 · 点击任务进入工作区
      </div>
    </div>
  );
}
