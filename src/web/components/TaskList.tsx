import { CheckCircle2, Clock3, FileText } from "lucide-react";

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
            className={`task-row ${selectedTaskId === task.taskId ? "is-selected" : ""}`}
            onClick={() => onSelect(task.taskId)}
          >
            <span className="task-row-header">
              <span className="task-row-title">
                <FileText aria-hidden="true" size={17} />
                {task.title}
              </span>
              <PriorityBadge priority={task.priority} />
            </span>

            <span className="task-row-brief">{task.brief}</span>

            <span className="task-row-meta">
              <StatusBadge status={task.status} />
              <span><Clock3 aria-hidden="true" size={14} />{formatDateTime(task.updatedAt)}</span>
              <span><CheckCircle2 aria-hidden="true" size={14} />{task.completedSubtasks}/{task.subtaskCount}</span>
            </span>

            <span className="progress-track" aria-label={`${progress}% complete`}>
              <span className="progress-fill" style={{ width: `${progress}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
