import { useState } from "react";
import { Edit3, FolderGit2, Plus, Save, UserRound } from "lucide-react";
import MDEditor from '@uiw/react-md-editor';

import { TASK_STATUSES, type TaskMutationInput, type TaskPriority, type WorkspaceProject } from "../api/types";

interface TaskFormProps {
  mode: "create" | "edit";
  value: TaskMutationInput;
  projectRoot: string;
  isPortfolioMode?: boolean;
  projects?: WorkspaceProject[];
  canSubmit: boolean;
  isBusy: boolean;
  onModeChange: (mode: "create" | "edit" | null) => void;
  onChange: (value: TaskMutationInput) => void;
  onSubmit: () => void;
}

const CUSTOM_PATH_SENTINEL = "__custom__";

const priorities: TaskPriority[] = ["low", "normal", "high", "urgent"];

function formatOptionLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function TaskForm({
  mode,
  value,
  projectRoot,
  isPortfolioMode = false,
  projects = [],
  canSubmit,
  isBusy,
  onModeChange,
  onChange,
  onSubmit,
}: TaskFormProps) {
  // When the chosen project root isn't one of the known projects, fall through to a free-text path.
  const knownRoots = projects.map((project) => project.projectRoot);
  const [customMode, setCustomMode] = useState(
    () => value.scope === "project" && Boolean(value.projectRoot) && !knownRoots.includes(value.projectRoot),
  );

  // The project picker is only needed in portfolio mode; in focus mode the ambient project is implied.
  const showProjectPicker = value.scope === "project" && isPortfolioMode;

  function handlePickProject(selected: string) {
    if (selected === CUSTOM_PATH_SENTINEL) {
      setCustomMode(true);
      onChange({ ...value, projectRoot: "" });
      return;
    }
    setCustomMode(false);
    onChange({ ...value, projectRoot: selected });
  }

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
            <Plus aria-hidden="true" size={13} />
            New
          </button>
          <button
            type="button"
            aria-pressed={mode === "edit"}
            className={mode === "edit" ? "is-active" : ""}
            onClick={() => onModeChange("edit")}
          >
            <Edit3 aria-hidden="true" size={13} />
            Edit
          </button>
        </div>
      </div>

      <div className="panel-body">
        <label className="field">
          <span>Title</span>
          <input
            value={value.title}
            placeholder="Checkout flow hardening"
            onChange={(event) => onChange({ ...value, title: event.target.value })}
          />
        </label>

        <label className="field">
          <span>Content (Markdown)</span>
          <div data-color-mode="light" style={{ marginTop: 4 }}>
            <MDEditor
              value={value.brief}
              onChange={(val) => onChange({ ...value, brief: val || '' })}
              height={220}
              preview="edit"
              visibleDragbar={false}
              textareaProps={{
                placeholder: 'Write in Markdown...\n\n# Goal\n\n- Item 1\n- Item 2\n\n> Acceptance criteria here',
              }}
            />
          </div>
          <p className="form-hint" style={{ marginTop: 6, fontSize: '12px' }}>
            支持 Markdown 语法（标题、列表、代码块、引用等）。用户根目录任务推荐使用富文本格式。
          </p>
        </label>

        <div className="segmented-control compact scope-control" aria-label="Task scope">
          <button
            type="button"
            aria-pressed={value.scope === "project"}
            className={value.scope === "project" ? "is-active" : ""}
            onClick={() => onChange({
              ...value,
              scope: "project",
              taskType: "coding",
              // Keep an explicitly-picked project; otherwise default to the ambient (focus) project.
              projectRoot: value.projectRoot || projectRoot,
            })}
          >
            <FolderGit2 aria-hidden="true" size={13} />
            Project
          </button>
          <button
            type="button"
            aria-pressed={value.scope === "user"}
            className={value.scope === "user" ? "is-active" : ""}
            onClick={() => onChange({
              ...value,
              scope: "user",
              taskType: "general",
              projectRoot: "",
            })}
          >
            <UserRound aria-hidden="true" size={13} />
            User
          </button>
        </div>

        {isPortfolioMode && value.scope === "user" && (
          <p className="form-hint">
            用户根目录模式下，推荐创建 User 级任务（跨项目规划）
          </p>
        )}

        {showProjectPicker && (
          <label className="field">
            <span>关联项目</span>
            {projects.length > 0 && !customMode ? (
              <select
                value={knownRoots.includes(value.projectRoot) ? value.projectRoot : ""}
                onChange={(event) => handlePickProject(event.target.value)}
              >
                <option value="" disabled>选择一个项目…</option>
                {projects.map((project) => (
                  <option key={project.projectRoot} value={project.projectRoot}>
                    {project.shortName} · {project.projectRoot}
                  </option>
                ))}
                <option value={CUSTOM_PATH_SENTINEL}>其他路径…</option>
              </select>
            ) : (
              <input
                value={value.projectRoot}
                placeholder="/absolute/path/to/project"
                onChange={(event) => onChange({ ...value, projectRoot: event.target.value })}
              />
            )}
            <p className="form-hint" style={{ marginTop: 6 }}>
              粗任务关联到项目后，可进入项目视图拆分子任务并设置并发度。
              {projects.length > 0 && customMode && (
                <button
                  type="button"
                  className="link-button"
                  style={{ marginLeft: 6 }}
                  onClick={() => { setCustomMode(false); onChange({ ...value, projectRoot: "" }); }}
                >
                  从已有项目选择
                </button>
              )}
            </p>
          </label>
        )}

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
          <Save aria-hidden="true" size={15} />
          {mode === "create" ? "Create task" : "Save edits"}
        </button>
      </div>
    </section>
  );
}
