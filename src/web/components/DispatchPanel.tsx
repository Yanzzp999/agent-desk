import { useState } from "react";
import { Send, SlidersHorizontal } from "lucide-react";

export interface DispatchParams {
  parallel: number;
  model: string;
  reasoning: string;
}

interface DispatchPanelProps {
  /** Number of subtasks — drives the suggested concurrency cap. */
  subtaskCount: number;
  disabled?: boolean;
  isBusy?: boolean;
  onDispatch: (params: DispatchParams) => void | Promise<void>;
}

const DEFAULT_PARALLEL = 6;

export function DispatchPanel({ subtaskCount, disabled = false, isBusy = false, onDispatch }: DispatchPanelProps) {
  const [open, setOpen] = useState(false);
  const [parallel, setParallel] = useState(DEFAULT_PARALLEL);
  const [model, setModel] = useState("gpt-5.5");
  const [reasoning, setReasoning] = useState("xhigh");

  const cap = Math.max(1, subtaskCount || DEFAULT_PARALLEL);
  const effectiveParallel = Math.max(1, Math.min(parallel, 12));

  return (
    <div className={`dispatch-panel ${open ? "is-open" : ""}`}>
      <div className="dispatch-primary">
        <button
          type="button"
          className="primary-action"
          disabled={disabled || isBusy}
          onClick={() => void onDispatch({ parallel: effectiveParallel, model, reasoning })}
          title={`并发 ${effectiveParallel} 个 subagent 派发执行`}
        >
          <Send size={14} />
          派发 ({effectiveParallel}×)
        </button>
        <button
          type="button"
          className="ghost-action dispatch-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title="并发与模型设置"
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>

      {open && (
        <div className="dispatch-controls" role="group" aria-label="派发参数">
          <label className="dispatch-field">
            <span>并发度</span>
            <input
              type="range"
              min={1}
              max={12}
              value={effectiveParallel}
              onChange={(e) => setParallel(Number(e.target.value))}
              disabled={disabled || isBusy}
            />
            <strong className="dispatch-value">{effectiveParallel}</strong>
          </label>
          {subtaskCount > 0 && (
            <p className="dispatch-hint">
              当前 {subtaskCount} 个子任务 · 建议并发 ≤ {Math.min(cap, 12)}（每子任务一个 subagent）
            </p>
          )}
          <div className="dispatch-field-row">
            <label className="dispatch-field">
              <span>模型</span>
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={disabled || isBusy}>
                <option value="gpt-5.5">gpt-5.5</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="o3">o3</option>
              </select>
            </label>
            <label className="dispatch-field">
              <span>推理</span>
              <select value={reasoning} onChange={(e) => setReasoning(e.target.value)} disabled={disabled || isBusy}>
                <option value="xhigh">xhigh</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
