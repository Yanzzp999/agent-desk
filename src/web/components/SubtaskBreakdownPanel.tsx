import { useEffect, useMemo, useState } from "react";
import { Check, ListTree, Lock, Plus, Sparkles, Trash2, X } from "lucide-react";

import type { SubtaskRow } from "../api/types";

interface SubtaskBreakdownPanelProps {
  subtasks: SubtaskRow[];
  /** Task-level default concurrency, shown as the placeholder for "inherit". */
  defaultParallel: number;
  isBusy: boolean;
  /** Run AI breakdown; resolves to proposed rows the user can edit. */
  onAiBreakdown: () => Promise<SubtaskRow[]>;
  /** Persist the edited rows back to the task markdown. */
  onSave: (rows: SubtaskRow[]) => void | Promise<void>;
}

function rowsEqual(a: SubtaskRow[], b: SubtaskRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) =>
    row.title === b[i].title && row.checked === b[i].checked && (row.parallel ?? 0) === (b[i].parallel ?? 0)
  );
}

export function SubtaskBreakdownPanel({
  subtasks,
  defaultParallel,
  isBusy,
  onAiBreakdown,
  onSave,
}: SubtaskBreakdownPanelProps) {
  const [rows, setRows] = useState<SubtaskRow[]>(subtasks);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Re-seed from server whenever the underlying task changes (different markdown).
  useEffect(() => {
    setRows(subtasks);
  }, [subtasks]);

  const dirty = useMemo(() => !rowsEqual(rows, subtasks), [rows, subtasks]);
  const completed = rows.filter((r) => r.checked).length;

  function updateRow(index: number, patch: Partial<SubtaskRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, { title: "", checked: false }]);
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  async function runAi() {
    setAiRunning(true);
    setAiError(null);
    try {
      const proposed = await onAiBreakdown();
      if (proposed.length > 0) {
        setRows(proposed);
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI 拆分失败，请重试或手动添加。");
    } finally {
      setAiRunning(false);
    }
  }

  return (
    <section className="workspace-section subtask-panel">
      <div className="section-header">
        <ListTree size={14} />
        <span>子任务拆分</span>
        <span className="subtask-progress-chip">{completed}/{rows.length}</span>
        <div className="section-actions">
          <button
            type="button"
            className="ghost tiny ai-breakdown-btn"
            onClick={() => void runAi()}
            disabled={isBusy || aiRunning}
            title="调用 codex 自动生成子任务清单（可能需要数十秒）"
          >
            <Sparkles size={13} className={aiRunning ? "spin" : ""} />
            {aiRunning ? "AI 拆分中…" : "AI 拆分"}
          </button>
          <button type="button" className="ghost tiny" onClick={addRow} disabled={isBusy || aiRunning}>
            <Plus size={13} />
            添加
          </button>
        </div>
      </div>

      {aiError && <p className="subtask-error">{aiError}</p>}

      {rows.length === 0 ? (
        <p className="subtask-empty">
          还没有子任务。点击「AI 拆分」让 codex 读取任务自动生成，或「添加」手动逐条录入。
          派发时每个子任务会分配一个 subagent 并行执行。
        </p>
      ) : (
        <ul className="subtask-rows">
          {rows.map((row, index) => {
            const exclusive = row.parallel === 1;
            return (
              <li key={index} className={`subtask-row ${row.checked ? "is-done" : ""}`}>
                <button
                  type="button"
                  className={`subtask-check ${row.checked ? "is-checked" : ""}`}
                  onClick={() => updateRow(index, { checked: !row.checked })}
                  disabled={isBusy || aiRunning}
                  aria-label={row.checked ? "标记未完成" : "标记完成"}
                >
                  {row.checked && <Check size={12} />}
                </button>
                <input
                  className="subtask-title-input"
                  value={row.title}
                  placeholder="描述一个可由单个 subagent 完成的子任务…"
                  onChange={(e) => updateRow(index, { title: e.target.value })}
                  disabled={isBusy || aiRunning}
                />
                <label className={`subtask-parallel ${exclusive ? "is-exclusive" : ""}`} title="该子任务的并发度。1 = 独占运行（其它子任务暂停）；留空 = 继承任务默认。">
                  {exclusive ? <Lock size={11} /> : <span className="subtask-parallel-x">×</span>}
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={row.parallel ?? ""}
                    placeholder={String(defaultParallel)}
                    onChange={(e) => {
                      const next = e.target.value.trim();
                      const num = Number(next);
                      updateRow(index, { parallel: next && Number.isFinite(num) && num > 0 ? num : undefined });
                    }}
                    disabled={isBusy || aiRunning}
                  />
                </label>
                <button
                  type="button"
                  className="subtask-remove"
                  onClick={() => removeRow(index)}
                  disabled={isBusy || aiRunning}
                  aria-label="删除子任务"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="subtask-footer">
        <span className="subtask-hint">
          每行的 × 数字为该子任务并发度；填 1 表示独占。空 = 继承任务默认（{defaultParallel}）。
        </span>
        <div className="subtask-footer-actions">
          {dirty && (
            <button
              type="button"
              className="ghost tiny"
              onClick={() => setRows(subtasks)}
              disabled={isBusy || aiRunning}
            >
              <X size={13} />
              重置
            </button>
          )}
          <button
            type="button"
            className="secondary-action tiny"
            onClick={() => void onSave(rows)}
            disabled={isBusy || aiRunning || !dirty}
          >
            <Check size={13} />
            保存子任务
          </button>
        </div>
      </div>
    </section>
  );
}
