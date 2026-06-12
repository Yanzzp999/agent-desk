import type { ReactNode } from "react";

import type { SessionStatus, TaskPriority, TaskStatus } from "../api/types";

export function StatusBadge({ status }: { status: TaskStatus | SessionStatus }) {
  return <span className={`status-badge status-${status}`}>{status.replaceAll("_", " ")}</span>;
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <span className={`priority-badge priority-${priority}`}>{priority}</span>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <div className="empty-state-description">{children}</div>
    </div>
  );
}

export function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatPercent(completed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.round((completed / total) * 100);
}
