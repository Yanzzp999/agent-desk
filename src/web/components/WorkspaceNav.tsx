import { useMemo } from "react";
import {
  FolderGit2,
  Plus,
  Search,
  RefreshCw,
  Inbox,
} from "lucide-react";

import type { WorkspaceProjectGroup } from "../api/types";

interface WorkspaceNavProps {
  groups: WorkspaceProjectGroup[];
  selectedProjectRoot: string;
  onSelectProject: (projectRoot: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  onImportProject?: () => void;
  isImporting?: boolean;
  onNewTask?: () => void;
}

function getStatusAggregate(tasks: WorkspaceProjectGroup["tasks"]): {
  total: number;
  running: number;
  succeeded: number;
  failed: number;
  ready: number;
} {
  return {
    total: tasks.length,
    running: tasks.filter((t) => t.status === "running").length,
    succeeded: tasks.filter((t) => t.status === "succeeded").length,
    failed: tasks.filter((t) => t.status === "blocked" || t.status === "failed").length,
    ready: tasks.filter((t) => t.status === "ready" || t.status === "claimed").length,
  };
}

export function WorkspaceNav({
  groups,
  selectedProjectRoot,
  onSelectProject,
  searchQuery,
  onSearchChange,
  onRefresh,
  isLoading,
  onImportProject,
  isImporting,
  onNewTask,
}: WorkspaceNavProps) {
  // Merge user tasks and project groups into a flat list of "projects"
  const allProjects = useMemo(() => {
    return groups.map((g) => ({
      projectRoot: g.project.projectRoot,
      shortName: g.project.projectRoot === "" ? "My Tasks" : g.project.shortName,
      taskCount: g.project.taskCount,
      lastUpdatedAt: g.project.lastUpdatedAt,
      stats: getStatusAggregate(g.tasks),
      isUser: g.project.projectRoot === "",
    }));
  }, [groups]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allProjects;
    return allProjects.filter(
      (p) => p.shortName.toLowerCase().includes(q) || p.projectRoot.toLowerCase().includes(q)
    );
  }, [allProjects, searchQuery]);

  return (
    <div className="workspace-nav">
      {/* Search bar */}
      <div className="nav-toolbar">
        <div className="nav-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索项目..."
            aria-label="搜索项目"
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

      {/* New task + import actions */}
      <div className="nav-actions-row">
        <button
          type="button"
          className="nav-action-btn primary"
          onClick={onNewTask}
        >
          <Plus size={14} />
          <span>新任务</span>
        </button>
        {onImportProject && (
          <button
            type="button"
            className="nav-action-btn ghost"
            disabled={isImporting}
            onClick={onImportProject}
          >
            <Inbox size={14} />
            <span>{isImporting ? "导入中..." : "导入项目"}</span>
          </button>
        )}
      </div>

      {/* Project list */}
      <div className="nav-projects-list" role="list">
        {filtered.length === 0 && (
          <div className="nav-empty">
            {searchQuery ? "没有匹配的项目" : "还没有项目，点击「导入项目」开始"}
          </div>
        )}

        {filtered.map((project) => {
          const isActive = selectedProjectRoot === project.projectRoot;
          const { stats } = project;

          return (
            <button
              key={project.projectRoot || "__user__"}
              type="button"
              className={`nav-project-card ${isActive ? "is-active" : ""}`}
              onClick={() => onSelectProject(project.projectRoot)}
              role="listitem"
            >
              <div className="nav-project-icon">
                {project.isUser ? (
                  <span className="nav-project-avatar user">U</span>
                ) : (
                  <FolderGit2 size={16} />
                )}
              </div>
              <div className="nav-project-info">
                <span className="nav-project-name">{project.shortName}</span>
                <span className="nav-project-meta">
                  {stats.running > 0 && (
                    <span className="nav-stat running">{stats.running} running</span>
                  )}
                  {stats.ready > 0 && (
                    <span className="nav-stat ready">{stats.ready} ready</span>
                  )}
                  {stats.succeeded > 0 && (
                    <span className="nav-stat succeeded">{stats.succeeded} done</span>
                  )}
                  {stats.failed > 0 && (
                    <span className="nav-stat failed">{stats.failed} issue</span>
                  )}
                  {stats.total > 0 && (
                    <span className="nav-stat total">{stats.total} 任务</span>
                  )}
                  {stats.total === 0 && (
                    <span className="nav-stat empty">暂无任务</span>
                  )}
                </span>
              </div>
              <span className="nav-project-count">{project.taskCount}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
