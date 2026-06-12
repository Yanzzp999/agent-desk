import { CheckCircle2, Clock3, UserRound } from "lucide-react";

import type { AgentDeskTask } from "../api/types";
import { EmptyState, formatDateTime, formatPercent, PriorityBadge, StatusBadge } from "./ui";

interface TaskListProps {
  tasks: AgentDeskTask[];
  selectedTaskId?: string;
  onSelect: (taskId: string) => void;
  isFocusedProject?: boolean;   // true when viewing one specific project
}

export function TaskList({ tasks, selectedTaskId, onSelect, isFocusedProject }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="panel-body">
        <EmptyState title="No matching tasks">
          {isFocusedProject 
            ? "This project has no tasks matching the current filters (e.g. 'Day' range). Try switching to 'Week' or 'Month', or create a new task for this project."
            : "Adjust the filters or create a new AgentDesk task for this project root."}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="task-list" role="list">
      {tasks.map((task) => {
        const progress = formatPercent(task.completedSubtasks, task.subtaskCount);
        const isSelected = selectedTaskId === task.taskId;

        return (
          <button
            key={task.taskId}
            type="button"
            aria-pressed={isSelected}
            className={`task-row ${isSelected ? "is-selected" : ""}`}
            onClick={() => onSelect(task.taskId)}
          >
            <span className="task-row-bullet" aria-hidden="true" />

            <span className="task-row-title">
              <span>{task.title}</span>
            </span>

            <span className="task-row-priority">
              <PriorityBadge priority={task.priority} />
            </span>

            {/* Quick-win 项目徽章（从任务自带的 projectRoot/scope 展示） */}
            <span className="task-project-badge" title={task.scope === "user" ? "User-level task" : task.projectRoot}>
              {task.scope === "user" ? "User" : (task.projectRoot?.split(/[\\/]/).pop() || "Project")}
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
              <span><Clock3 aria-hidden="true" size={13} />{formatDateTime(task.updatedAt)}</span>
              <span><UserRound aria-hidden="true" size={13} />{task.claimedBy || "Open"}</span>
              <span><CheckCircle2 aria-hidden="true" size={13} />{task.completedSubtasks}/{task.subtaskCount}</span>
            </span>

            <span className="task-progress-bar">
              <span className="progress-track" aria-label={`${progress}% complete`}>
                <span className="progress-fill" style={{ width: `${progress}%` }} />
              </span>
              <span className="progress-label">{progress}%</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
