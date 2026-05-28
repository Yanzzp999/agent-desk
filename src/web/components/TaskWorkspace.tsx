import { useState } from "react";
import {
  ChevronRight,
  Edit3,
  FileText,
  FolderGit2,
  Play,
  Send,
  Trash2,
  UserPlus,
  UserRound,
  Plus,
  ArrowLeft,
} from "lucide-react";

import type { AgentDeskTask, AgentDeskTaskDetail, ComposerLaunchParams } from "../api/types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Composer } from "./Composer";
import { EmptyState, formatDateTime, formatPercent, PriorityBadge, StatusBadge } from "./ui";

interface TaskWorkspaceProps {
  tasks: AgentDeskTask[];
  taskDetail: AgentDeskTaskDetail | null;
  selectedProjectRoot: string;
  selectedProjectName: string;
  canMutate: boolean;
  isBusy: boolean;
  onClaim: () => void | Promise<void>;
  onDispatch: () => void | Promise<void>;
  onUpdateBrief: (newBrief: string) => void | Promise<void>;
  onComposerSend: (
    text: string,
    params: ComposerLaunchParams,
    action: "append" | "new-task"
  ) => void | Promise<void>;
  onSelectTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void | Promise<void>;
  onNewTask: () => void;
  onBackToProjects?: () => void;
}

function getStatusDotColor(status: AgentDeskTask["status"]): string {
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

export function TaskWorkspace({
  tasks,
  taskDetail,
  selectedProjectRoot,
  selectedProjectName,
  canMutate,
  isBusy,
  onClaim,
  onDispatch,
  onUpdateBrief,
  onComposerSend,
  onSelectTask,
  onDeleteTask,
  onNewTask,
  onBackToProjects,
}: TaskWorkspaceProps) {
  const [isEditingMarkdown, setIsEditingMarkdown] = useState(false);
  const [draftBrief, setDraftBrief] = useState("");
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  // Determine if we're showing the task list or a single task detail
  const showingDetail = taskDetail !== null;

  function startEdit() {
    if (!taskDetail) return;
    setDraftBrief(taskDetail.brief || taskDetail.markdown || "");
    setIsEditingMarkdown(true);
  }

  async function saveEdit() {
    if (!taskDetail) return;
    if (draftBrief.trim() === (taskDetail.brief || taskDetail.markdown || "").trim()) {
      setIsEditingMarkdown(false);
      return;
    }
    await onUpdateBrief(draftBrief.trim());
    setIsEditingMarkdown(false);
  }

  function cancelEdit() {
    setIsEditingMarkdown(false);
  }

  async function handleDeleteTask(taskId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (deletingTaskId === taskId) {
      // Second click: confirm delete
      setDeletingTaskId(null);
      await onDeleteTask(taskId);
    } else {
      // First click: ask for confirmation
      setDeletingTaskId(taskId);
      // Auto-reset after 3 seconds
      setTimeout(() => setDeletingTaskId((prev) => (prev === taskId ? null : prev)), 3000);
    }
  }

  const progress = taskDetail ? formatPercent(taskDetail.completedSubtasks, taskDetail.subtaskCount) : 0;

  return (
    <div className="task-workspace">
      {/* Project header */}
      <div className="workspace-header">
        <div className="workspace-title">
          {showingDetail && onBackToProjects && (
            <button
              type="button"
              className="back-btn"
              onClick={onBackToProjects}
              aria-label="返回任务列表"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="eyebrow">
            {selectedProjectRoot ? "Project" : "My Tasks"} · {tasks.length} 任务
          </div>
          <h1>{selectedProjectName}</h1>
        </div>
        <div className="workspace-actions">
          <button
            type="button"
            className="primary-action"
            onClick={onNewTask}
            disabled={isBusy}
          >
            <Plus size={15} />
            新任务
          </button>
        </div>
      </div>

      {showingDetail ? (
        // === Task detail view ===
        <>
          <div className="workspace-detail-header">
            <div className="detail-title-row">
              <h2>{taskDetail!.title}</h2>
              <div className="workspace-badges">
                <StatusBadge status={taskDetail!.status} />
                <PriorityBadge priority={taskDetail!.priority} />
              </div>
            </div>
            <div className="detail-actions-row">
              <button
                type="button"
                className="secondary-action"
                disabled={!canMutate || isBusy}
                onClick={onClaim}
              >
                <UserPlus size={14} />
                Claim
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={!canMutate || isBusy}
                onClick={onDispatch}
              >
                <Send size={14} />
                Dispatch (6x)
              </button>
              <button
                type="button"
                className="ghost-action"
                onClick={isEditingMarkdown ? cancelEdit : startEdit}
              >
                <Edit3 size={14} />
                {isEditingMarkdown ? "取消" : "编辑"}
              </button>
              <button
                type="button"
                className="ghost-action danger"
                disabled={isBusy}
                onClick={(e) => void handleDeleteTask(taskDetail!.taskId, e)}
              >
                <Trash2 size={14} />
                {deletingTaskId === taskDetail!.taskId ? "确认删除?" : "删除"}
              </button>
            </div>
          </div>

          {/* Meta strip */}
          <div className="workspace-meta-strip">
            <div className="meta-item">
              <span>更新</span>
              <strong>{formatDateTime(taskDetail!.updatedAt)}</strong>
            </div>
            <div className="meta-item">
              <span>负责人</span>
              <strong>{taskDetail!.claimedBy || "未领取"}</strong>
            </div>
            <div className="meta-item">
              <span>进度</span>
              <strong>{taskDetail!.completedSubtasks}/{taskDetail!.subtaskCount} · {progress}%</strong>
            </div>
            <div className="meta-item path">
              {taskDetail!.scope === "user" ? <UserRound size={13} /> : <FolderGit2 size={13} />}
              <span title={taskDetail!.projectRoot}>
                {taskDetail!.scope === "user" ? "用户级任务" : taskDetail!.projectRoot}
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="workspace-progress">
            <div className="progress-track large">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Markdown content */}
          <section className="workspace-section markdown-section">
            <div className="section-header">
              <FileText size={14} />
              <span>任务内容</span>
              {isEditingMarkdown && (
                <div className="section-actions">
                  <button type="button" className="ghost tiny" onClick={saveEdit} disabled={isBusy}>
                    保存
                  </button>
                  <button type="button" className="ghost tiny" onClick={cancelEdit}>
                    取消
                  </button>
                </div>
              )}
            </div>
            {isEditingMarkdown ? (
              <textarea
                className="markdown-editor"
                value={draftBrief}
                onChange={(e) => setDraftBrief(e.target.value)}
                disabled={isBusy}
                rows={12}
              />
            ) : (
              <div className="markdown-body">
                <MarkdownRenderer content={taskDetail!.markdown || taskDetail!.brief} />
              </div>
            )}
          </section>

          {/* Sessions */}
          {taskDetail!.recentSessions.length > 0 && (
            <section className="workspace-section sessions-section">
              <div className="section-header">
                <Play size={14} />
                <span>最近会话 ({taskDetail!.recentSessions.length})</span>
              </div>
              <div className="mini-session-list">
                {taskDetail!.recentSessions.map((s) => (
                  <div key={s.sessionId} className="mini-session">
                    <span className="mini-session-id">{s.sessionId}</span>
                    <StatusBadge status={s.status} />
                    <span className="mini-session-count">
                      {s.agents.succeeded}/{s.agents.total}
                    </span>
                    <span className="mini-session-time">{formatDateTime(s.startedAt)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Composer */}
          <div className="workspace-composer-anchor">
            <Composer
              onSend={onComposerSend}
              disabled={!canMutate || isBusy}
              defaultParams={{ model: "gpt-5.5", reasoning: "xhigh", serviceTier: "fast" }}
              placeholder="输入指令追加到当前任务，或创建新任务..."
              compact
            />
          </div>
        </>
      ) : (
        // === Task list view ===
        <div className="task-list-view">
          {tasks.length === 0 ? (
            <EmptyState title="暂无任务">
              <div style={{ textAlign: "center", fontSize: 13, lineHeight: 1.6 }}>
                点击右上角「新任务」创建第一个任务，
                或从左侧导入已有项目。
              </div>
            </EmptyState>
          ) : (
            <div className="task-rows" role="list">
              {tasks.map((task) => {
                const isDeleting = deletingTaskId === task.taskId;
                return (
                  <button
                    key={task.taskId}
                    type="button"
                    className="task-row-item"
                    onClick={() => onSelectTask(task.taskId)}
                    role="listitem"
                  >
                    <span
                      className="task-row-dot"
                      style={{ backgroundColor: getStatusDotColor(task.status) }}
                      aria-hidden="true"
                    />
                    <div className="task-row-content">
                      <span className="task-row-title">{task.title}</span>
                      <span className="task-row-brief">
                        {task.brief.length > 80 ? task.brief.slice(0, 77) + "..." : task.brief}
                      </span>
                    </div>
                    <div className="task-row-side">
                      <StatusBadge status={task.status} />
                      <PriorityBadge priority={task.priority} />
                      <span className="task-row-time">{formatDateTime(task.updatedAt)}</span>
                      <button
                        type="button"
                        className={`task-row-delete ${isDeleting ? "confirming" : ""}`}
                        onClick={(e) => void handleDeleteTask(task.taskId, e)}
                        disabled={isBusy}
                        aria-label={isDeleting ? "确认删除" : "删除任务"}
                      >
                        <Trash2 size={13} />
                      </button>
                      <ChevronRight size={16} className="task-row-chevron" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
