import { CheckCircle2, Clock3, FileText, UserRound } from "lucide-react";

import type { AgentDeskTask } from "../api/types";
import { EmptyState, formatDateTime, formatPercent, PriorityBadge, StatusBadge } from "./ui";

interface TaskListProps {
  tasks: AgentDeskTask[];
  selectedTaskId?: string;
  onSelect: (taskId: string) => void;
}

export function TaskList({ tasks, selectedTaskId, onSelect }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <EmptyState title="No matching tasks">
        Adjust the filters or create a new AgentDesk task for this project root.
      </EmptyState>
    );
  }

  return (
    <div className="task-list" role="list">
      {tasks.map((task) => {
        const progress = formatPercent(task.completedSubtasks, task.subtaskCount);

        return (
          <button
            key={task.taskId}
            type="button"
            aria-pressed={selectedTaskId === task.taskId}
            className={`task-row ${selectedTaskId === task.taskId ? "is-selected" : ""}`}
            onClick={() => onSelect(task.taskId)}
          >
            <span className="task-row-header">
              <span className="task-row-title">
                <FileText aria-hidden="true" size={17} />
                <span>{task.title}</span>
              </span>
              <PriorityBadge priority={task.priority} />
            </span>

            <span className="task-row-brief">{task.brief}</span>

            {task.tags.length > 0 && (
              <span className="task-tag-list" aria-label="Task tags">
                {task.tags.map((tag) => (
                  <span key={tag} className="task-tag">{tag}</span>
                ))}
              </span>
            )}

            <span className="task-row-meta">
              <StatusBadge status={task.status} />
              <span><Clock3 aria-hidden="true" size={14} />{formatDateTime(task.updatedAt)}</span>
              <span><UserRound aria-hidden="true" size={14} />{task.claimedBy || "Open"}</span>
              <span><CheckCircle2 aria-hidden="true" size={14} />{task.completedSubtasks}/{task.subtaskCount}</span>
            </span>

            <span className="task-progress-row">
              <span className="progress-track" aria-label={`${progress}% complete`}>
                <span className="progress-fill" style={{ width: `${progress}%` }} />
              </span>
              <span>{progress}%</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
