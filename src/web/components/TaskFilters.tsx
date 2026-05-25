import { CalendarDays, Filter, RotateCcw, Search, UserRound } from "lucide-react";

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

const defaultFilters: TaskFiltersValue = {
  range: "week",
  status: "all",
  query: "",
  assignee: "",
};

function formatOptionLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function TaskFilters({ filters, onChange }: TaskFiltersProps) {
  const hasActiveFilters = filters.range !== defaultFilters.range
    || filters.status !== defaultFilters.status
    || filters.query.trim().length > 0
    || filters.assignee.trim().length > 0;

  return (
    <section className="toolbar" aria-label="Task filters">
      <div className="segmented-control" aria-label="Planning range">
        {ranges.map((range) => (
          <button
            key={range.value}
            type="button"
            aria-pressed={filters.range === range.value}
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
            placeholder="Title, brief, tag"
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
            <option value="all">All statuses</option>
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>{formatOptionLabel(status)}</option>
            ))}
          </select>
        </div>
      </label>

      <label className="field">
        <span>Assignee</span>
        <div className="input-with-icon">
          <UserRound aria-hidden="true" size={16} />
          <input
            value={filters.assignee}
            placeholder="codex-ui"
            onChange={(event) => onChange({ ...filters, assignee: event.target.value })}
          />
        </div>
      </label>

      <button
        type="button"
        className="secondary-action toolbar-reset"
        disabled={!hasActiveFilters}
        onClick={() => onChange(defaultFilters)}
      >
        <RotateCcw aria-hidden="true" size={16} />
        Reset
      </button>
    </section>
  );
}
