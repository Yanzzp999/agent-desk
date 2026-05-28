import { useState } from "react";
import {
  CheckCircle2,
  Edit3,
  FileText,
  FolderGit2,
  Play,
  Send,
  UserPlus,
  UserRound,
} from "lucide-react";

import type { AgentDeskTaskDetail, ComposerLaunchParams } from "../api/types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Composer } from "./Composer";
import { EmptyState, formatDateTime, formatPercent, PriorityBadge, StatusBadge } from "./ui";

interface TaskWorkspaceProps {
  task: AgentDeskTaskDetail | null;
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
  isPortfolioMode?: boolean;
}

export function TaskWorkspace({
  task,
  canMutate,
  isBusy,
  onClaim,
  onDispatch,
  onUpdateBrief,
  onComposerSend,
  isPortfolioMode = false,
}: TaskWorkspaceProps) {
  const [isEditingMarkdown, setIsEditingMarkdown] = useState(false);
  const [draftBrief, setDraftBrief] = useState("");

  if (!task) {
    return (
      <div className="task-workspace empty">
        <EmptyState title="选择左侧项目和任务">
          <div style={{ maxWidth: 420, textAlign: "center", fontSize: 13, lineHeight: 1.6 }}>
            在左侧树中展开项目，点击任意任务即可在此工作区查看完整详情、编辑 task.md 内容、
            查看历史会话，并通过底部输入区追加指令或直接启动 Codex 子代理。
          </div>
        </EmptyState>
      </div>
    );
  }

  const progress = formatPercent(task.completedSubtasks, task.subtaskCount);
  const isEditing = isEditingMarkdown;

  function startEdit() {
    setDraftBrief(task!.brief || task!.markdown || "");
    setIsEditingMarkdown(true);
  }

  async function saveEdit() {
    if (draftBrief.trim() === (task!.brief || task!.markdown || "").trim()) {
      setIsEditingMarkdown(false);
      return;
    }
    await onUpdateBrief(draftBrief.trim());
    setIsEditingMarkdown(false);
  }

  function cancelEdit() {
    setIsEditingMarkdown(false);
  }

  return (
    <div className="task-workspace">
      {/* 顶部标题与操作栏 */}
      <div className="workspace-header">
        <div className="workspace-title">
          <div className="eyebrow">
            {task.scope === "user" ? "User Task" : "Project Task"} · {task.taskType}
          </div>
          <h1>{task.title}</h1>
          <div className="workspace-badges">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>
        </div>

        <div className="workspace-actions">
          <button
            type="button"
            className="secondary-action"
            disabled={!canMutate || isBusy}
            onClick={onClaim}
          >
            <UserPlus size={15} />
            Claim
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={!canMutate || isBusy}
            onClick={onDispatch}
          >
            <Send size={15} />
            Dispatch (6×)
          </button>
          <button
            type="button"
            className="ghost-action"
            onClick={isEditing ? cancelEdit : startEdit}
          >
            <Edit3 size={15} />
            {isEditing ? "取消编辑" : "编辑内容"}
          </button>
        </div>
      </div>

      {/* 元数据快速概览 */}
      <div className="workspace-meta-strip">
        <div className="meta-item">
          <span>更新</span>
          <strong>{formatDateTime(task.updatedAt)}</strong>
        </div>
        <div className="meta-item">
          <span>负责人</span>
          <strong>{task.claimedBy || "未领取"}</strong>
        </div>
        <div className="meta-item">
          <span>活跃会话</span>
          <strong>{task.activeSessionId || "无"}</strong>
        </div>
        <div className="meta-item">
          <span>进度</span>
          <strong>
            {task.completedSubtasks}/{task.subtaskCount} · {progress}%
          </strong>
        </div>
        <div className="meta-item path">
          {task.scope === "user" ? <UserRound size={14} /> : <FolderGit2 size={14} />}
          <span title={task.projectRoot}>{task.scope === "user" ? "用户级任务" : task.projectRoot}</span>
        </div>
      </div>

      {/* 进度条 */}
      <div className="workspace-progress">
        <div className="progress-track large">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Markdown 内容区（支持内联编辑） */}
      <section className="workspace-section markdown-section">
        <div className="section-header">
          <FileText size={15} />
          <span>任务内容（task.md / brief）</span>
          {isEditing && (
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

        {isEditing ? (
          <textarea
            className="markdown-editor"
            value={draftBrief}
            onChange={(e) => setDraftBrief(e.target.value)}
            disabled={isBusy}
            rows={12}
          />
        ) : (
          <div className="markdown-body">
            <MarkdownRenderer content={task.markdown || task.brief} />
          </div>
        )}
      </section>

      {/* Sessions 历史 */}
      {task.recentSessions.length > 0 && (
        <section className="workspace-section sessions-section">
          <div className="section-header">
            <Play size={15} />
            <span>最近会话（{task.recentSessions.length}）</span>
          </div>
          <div className="mini-session-list">
            {task.recentSessions.map((s) => (
              <div key={s.sessionId} className="mini-session">
                <span className="mini-session-id">{s.sessionId}</span>
                <StatusBadge status={s.status} />
                <span className="mini-session-count">
                  <CheckCircle2 size={13} />
                  {s.agents.succeeded}/{s.agents.total}
                </span>
                <span className="mini-session-time">{formatDateTime(s.startedAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 底部 Composer - Agent 协作核心入口 */}
      <div className="workspace-composer-anchor">
        <Composer
          onSend={onComposerSend}
          disabled={!canMutate || isBusy}
          defaultParams={{ model: "gpt-5.5", reasoning: "xhigh", serviceTier: "fast" }}
          placeholder={isPortfolioMode ? "输入新任务描述或追加到当前任务..." : "向当前任务追加指令，或创建新任务..."}
          compact
        />
      </div>
    </div>
  );
}
