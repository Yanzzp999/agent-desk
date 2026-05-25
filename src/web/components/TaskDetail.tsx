import { CheckCircle2, FileText, FolderGit2, Play, Send, UserPlus } from "lucide-react";

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
        <EmptyState title="Select a task">
          Choose a task from the queue to inspect task.md, ownership, and dispatch state.
        </EmptyState>
      </section>
    );
  }

  const progress = formatPercent(task.completedSubtasks, task.subtaskCount);

  return (
    <section className="panel detail-panel" aria-label="Task detail">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Task detail</p>
          <h2>{task.title}</h2>
        </div>
        <div className="badge-row">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
        </div>
      </div>

      <p className="detail-brief">{task.brief}</p>

      <div className="detail-grid">
        <div>
          <span>Updated</span>
          <strong>{formatDateTime(task.updatedAt)}</strong>
        </div>
        <div>
          <span>Claimed by</span>
          <strong>{task.claimedBy || "Open"}</strong>
        </div>
        <div>
          <span>Active session</span>
          <strong>{task.activeSessionId || "None"}</strong>
        </div>
        <div>
          <span>Checklist</span>
          <strong>{progress}%</strong>
        </div>
      </div>

      <div className="progress-track progress-large" aria-label={`${progress}% complete`}>
        <span className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="action-row">
        <button type="button" className="primary-action" disabled={!canMutate || isBusy} onClick={onClaim}>
          <UserPlus aria-hidden="true" size={17} />
          Claim
        </button>
        <button type="button" className="secondary-action" disabled={!canMutate || isBusy} onClick={onDispatch}>
          <Send aria-hidden="true" size={17} />
          Dispatch
        </button>
      </div>

      <div className="path-strip">
        <FolderGit2 aria-hidden="true" size={16} />
        <span>{task.projectRoot}</span>
      </div>

      <div className="task-md-block">
        <div className="block-title">
          <FileText aria-hidden="true" size={16} />
          <span>task.md</span>
        </div>
        <pre>{task.markdown}</pre>
      </div>

      {task.recentSessions.length > 0 && (
        <div className="mini-session-list">
          {task.recentSessions.map((session) => (
            <div key={session.sessionId} className="mini-session">
              <span><Play aria-hidden="true" size={15} />{session.sessionId}</span>
              <span><StatusBadge status={session.status} /></span>
              <span><CheckCircle2 aria-hidden="true" size={15} />{session.agents.succeeded}/{session.agents.total}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
