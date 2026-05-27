import { CheckCircle2, FileText, FolderGit2, Play, Send, UserPlus, UserRound } from "lucide-react";

import type { AgentDeskTaskDetail } from "../api/types";
import { EmptyState, formatDateTime, formatPercent, PriorityBadge, StatusBadge } from "./ui";

interface TaskDetailProps {
  task: AgentDeskTaskDetail | null;
  canMutate: boolean;
  isBusy: boolean;
  onClaim: () => void;
  onDispatch: () => void;
}

export function TaskDetail({ task, canMutate, isBusy, onClaim, onDispatch }: TaskDetailProps) {
  if (!task) {
    return (
      <section className="panel detail-panel">
        <div className="panel-body">
          <EmptyState title="Select a task">
            Choose a task from the queue to inspect task.md, ownership, and dispatch state.
          </EmptyState>
        </div>
      </section>
    );
  }

  const progress = formatPercent(task.completedSubtasks, task.subtaskCount);

  return (
    <section className="panel detail-panel" aria-label="Task detail">
      <div className="panel-heading">
        <div className="detail-title-row">
          <div>
            <p className="eyebrow">Task detail</p>
            <h2>{task.title}</h2>
          </div>
          <div className="badge-row">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>
        </div>
        <div className="action-row">
          <button type="button" className="primary-action" disabled={!canMutate || isBusy} onClick={onClaim}>
            <UserPlus aria-hidden="true" size={15} />
            Claim
          </button>
          <button type="button" className="secondary-action" disabled={!canMutate || isBusy} onClick={onDispatch}>
            <Send aria-hidden="true" size={15} />
            Dispatch
          </button>
        </div>
      </div>

      <div className="panel-body">
        <p className="detail-brief">{task.brief}</p>

        <div className="detail-grid">
          <div className="detail-stat">
            <span>Updated</span>
            <strong>{formatDateTime(task.updatedAt)}</strong>
          </div>
          <div className="detail-stat">
            <span>Claimed by</span>
            <strong>{task.claimedBy || "Open"}</strong>
          </div>
          <div className="detail-stat">
            <span>Active session</span>
            <strong>{task.activeSessionId || "None"}</strong>
          </div>
          <div className="detail-stat">
            <span>Checklist</span>
            <strong>{task.completedSubtasks}/{task.subtaskCount}</strong>
          </div>
        </div>

        <div className="progress-block">
          <div className="progress-block-label">
            <span>Subtask progress</span>
            <strong>{progress}%</strong>
          </div>
          <div className="progress-track progress-large" aria-label={`${progress}% complete`}>
            <span className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="path-strip">
          {task.scope === "user"
            ? <UserRound aria-hidden="true" size={14} />
            : <FolderGit2 aria-hidden="true" size={14} />}
          <span>{task.scope === "user" ? "User-level task" : task.projectRoot}</span>
        </div>

        <div className="task-md-block">
          <div className="block-title">
            <FileText aria-hidden="true" size={14} />
            <span>task.md</span>
          </div>
          <pre>{task.markdown}</pre>
        </div>

        {task.recentSessions.length > 0 && (
          <div className="mini-session-list">
            {task.recentSessions.map((session) => (
              <div key={session.sessionId} className="mini-session">
                <span className="mini-session-id">
                  <Play aria-hidden="true" size={13} />
                  {session.sessionId}
                </span>
                <StatusBadge status={session.status} />
                <span className="mini-session-count">
                  <CheckCircle2 aria-hidden="true" size={13} />
                  {session.agents.succeeded}/{session.agents.total}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
