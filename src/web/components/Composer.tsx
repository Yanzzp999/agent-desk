import { useState } from "react";
import { Send, Plus } from "lucide-react";

import type { ComposerLaunchParams } from "../api/types";

interface ComposerProps {
  disabled?: boolean;
  onSend: (text: string, launchParams: ComposerLaunchParams, action: "append" | "new-task") => void | Promise<void>;
  defaultParams?: Partial<ComposerLaunchParams>;
  placeholder?: string;
  compact?: boolean; // 树导航模式下更紧凑
}

const DEFAULT_PARAMS: ComposerLaunchParams = {
  model: "gpt-5.5",
  reasoning: "xhigh",
  serviceTier: "fast",
};

export function Composer({
  disabled = false,
  onSend,
  defaultParams,
  placeholder = "输入后续指令或新任务描述...",
  compact = false,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [params, setParams] = useState<ComposerLaunchParams>({
    ...DEFAULT_PARAMS,
    ...defaultParams,
  });
  const [isSending, setIsSending] = useState(false);

  const canSend = text.trim().length > 0 && !disabled && !isSending;

  async function handleSend(action: "append" | "new-task") {
    if (!canSend) return;

    setIsSending(true);
    try {
      await onSend(text.trim(), params, action);
      setText(""); // 清空输入
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend("append");
    }
  }

  return (
    <div className={`composer ${compact ? "compact" : ""}`}>
      <div className="composer-input-row">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isSending}
          rows={compact ? 2 : 3}
          className="composer-textarea"
        />
        <div className="composer-actions">
          <button
            type="button"
            className="composer-send primary"
            disabled={!canSend}
            onClick={() => void handleSend("append")}
            title="追加到当前任务并可选启动 (⌘Enter)"
          >
            <Send size={15} />
            <span>{isSending ? "发送中..." : "发送"}</span>
          </button>
          <button
            type="button"
            className="composer-new ghost"
            disabled={!canSend}
            onClick={() => void handleSend("new-task")}
            title="作为新任务创建"
          >
            <Plus size={14} />
            <span>新任务</span>
          </button>
        </div>
      </div>

      <div className="composer-meta">
        <div className="composer-params">
          <label>
            模型
            <select
              value={params.model}
              onChange={(e) => setParams({ ...params, model: e.target.value })}
              disabled={disabled || isSending}
            >
              <option value="gpt-5.5">gpt-5.5</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="o3">o3</option>
            </select>
          </label>
          <label>
            推理
            <select
              value={params.reasoning}
              onChange={(e) => setParams({ ...params, reasoning: e.target.value })}
              disabled={disabled || isSending}
            >
              <option value="xhigh">xhigh</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
            </select>
          </label>
          <label>
            档位
            <select
              value={params.serviceTier}
              onChange={(e) => setParams({ ...params, serviceTier: e.target.value })}
              disabled={disabled || isSending}
            >
              <option value="fast">fast</option>
              <option value="standard">standard</option>
            </select>
          </label>
        </div>
        <div className="composer-hint">
          ⌘Enter 发送 · 支持追加指令或新建任务
        </div>
      </div>
    </div>
  );
}
