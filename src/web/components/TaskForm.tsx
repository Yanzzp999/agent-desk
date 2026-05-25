import { Edit3, Plus, Save } from "lucide-react";

import { TASK_STATUSES, type TaskMutationInput, type TaskPriority } from "../api/types";

interface TaskFormProps {
  mode: "create" | "edit";
  value: TaskMutationInput;
  canSubmit: boolean;
  isBusy: boolean;
  onModeChange: (mode: "create" | "edit") => void;
  onChange: (value: TaskMutationInput) => void;
  onSubmit: () => void;
}

const priorities: TaskPriority[] = ["low", "normal", "high", "urgent"];

function formatOptionLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function TaskForm({
  mode,
  value,
  canSubmit,
  isBusy,
  onModeChange,
  onChange,
  onSubmit,
}: TaskFormProps) {
  return (
    <section className="panel form-panel" aria-label="Create or edit task">
      <div className="panel-heading compact-heading">
        <div>
          <p className="eyebrow">Task editor</p>
          <h2>{mode === "create" ? "Create task" : "Edit task"}</h2>
        </div>
        <div className="segmented-control compact" aria-label="Task editor mode">
          <button
            type="button"
            aria-pressed={mode === "create"}
            className={mode === "create" ? "is-active" : ""}
            onClick={() => onModeChange("create")}
          >
            <Plus aria-hidden="true" size={15} />
            New
          </button>
          <button
            type="button"
            aria-pressed={mode === "edit"}
            className={mode === "edit" ? "is-active" : ""}
            onClick={() => onModeChange("edit")}
          >
            <Edit3 aria-hidden="true" size={15} />
            Edit
          </button>
        </div>
      </div>

      <label className="field">
        <span>Title</span>
        <input
          value={value.title}
          placeholder="Checkout flow hardening"
          onChange={(event) => onChange({ ...value, title: event.target.value })}
        />
      </label>

      <label className="field">
        <span>Brief</span>
        <textarea
          value={value.brief}
          placeholder="Goal, scope, acceptance criteria, and anything agents should avoid."
          rows={5}
          onChange={(event) => onChange({ ...value, brief: event.target.value })}
        />
      </label>

      <div className="form-grid">
        <label className="field">
          <span>Status</span>
          <select
            value={value.status}
            onChange={(event) => onChange({ ...value, status: event.target.value as TaskMutationInput["status"] })}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>{formatOptionLabel(status)}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Priority</span>
          <select
            value={value.priority}
            onChange={(event) => onChange({ ...value, priority: event.target.value as TaskPriority })}
          >
            {priorities.map((priority) => (
              <option key={priority} value={priority}>{formatOptionLabel(priority)}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Tags</span>
        <input
          value={value.tags.join(", ")}
          placeholder="api, docs, session"
          onChange={(event) => onChange({
            ...value,
            tags: event.target.value
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          })}
        />
      </label>

      <button
        type="button"
        className="primary-action wide-action"
        aria-busy={isBusy}
        disabled={!canSubmit || isBusy}
        onClick={onSubmit}
      >
        <Save aria-hidden="true" size={17} />
        {mode === "create" ? "Create task" : "Save edits"}
      </button>
    </section>
  );
}
