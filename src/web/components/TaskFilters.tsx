import { CalendarDays, Filter, Search } from "lucide-react";

import { TASK_STATUSES, type TaskFilters as TaskFiltersValue, type TaskRange } from "../api/types";

interface TaskFiltersProps {
  filters: TaskFiltersValue;
  onChange: (filters: TaskFiltersValue) => void;
}

const ranges: Array<{ value: TaskRange; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export function TaskFilters({ filters, onChange }: TaskFiltersProps) {
  return (
    <section className="toolbar" aria-label="Task filters">
      <div className="segmented-control" aria-label="Planning range">
        {ranges.map((range) => (
          <button
            key={range.value}
            type="button"
            className={filters.range === range.value ? "is-active" : ""}
            onClick={() => onChange({ ...filters, range: range.value })}
          >
            <CalendarDays aria-hidden="true" size={16} />
            {range.label}
          </button>
        ))}
      </div>

      <label className="field field-search">
        <span>Search</span>
        <div className="input-with-icon">
          <Search aria-hidden="true" size={16} />
          <input
            value={filters.query}
            placeholder="task, status, tag"
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
          />
        </div>
      </label>

      <label className="field">
        <span>Status</span>
        <div className="input-with-icon">
          <Filter aria-hidden="true" size={16} />
          <select
            value={filters.status}
            onChange={(event) => onChange({
              ...filters,
              status: event.target.value as TaskFiltersValue["status"],
            })}
          >
            <option value="all">All</option>
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
      </label>

      <label className="field">
        <span>Assignee</span>
        <input
          value={filters.assignee}
          placeholder="worker-e"
          onChange={(event) => onChange({ ...filters, assignee: event.target.value })}
        />
      </label>
    </section>
  );
}
