# AgentDesk 运行设计

[English design](design.md)

这里说明 README 中只保留摘要的运行行为细节。

## Task generation

`create_agentdesk_task` 使用模型 `gpt-5.5`、reasoning `xhigh`、service tier `fast` 运行 `codex exec`。它只把 markdown 写入 `task.md`，并把 prompt/stdout/stderr artifact 存在 task 目录下；解析到可执行 checkbox subtasks 后，task 会标记为 `ready`。

如果已经存在相似 task，创建默认返回候选项，让调用方选择继续已有 task，或显式 rebuild 一个新 task。

## Session execution

`start_subagent_session` 从 `task.md` 解析 subtasks，并为每个 subtask 创建一个 agent 条目。默认值是模型 `gpt-5.5`、reasoning `xhigh`、service tier `fast`、execution mode `auto`、最大并发 `6`、启动批次大小 `6`。

`auto` 模式下，单任务、串行任务或明确无冲突的任务会使用当前 checkout。并行任务缺少无冲突证据，或显式请求 `worktree` 时，AgentDesk 会使用独立 git worktree。worktree 模式目前只支持 `codex-cli`。

每个 agent 都会有 `task.snapshot.md`、`memory.snapshot.md`、`prompt.md`、stdout/stderr 日志和结构化 report。`memory.md` 会注入 prompt，并在 agent 完成后更新。

## Codex App handoff

使用 `--subagent-launcher codex-app` 时，AgentDesk 只准备 session metadata 和 prompt 文件，不直接启动 app subagents。MCP 结果会包含 `requiresHostLaunch: true` 和 `appLaunchPlan`。

已准备好的 Codex App agent 会保持 `prepared_for_app`；AgentDesk 不会因为 launch plan 创建成功就把它们计为 succeeded。真正启动、等待和 host-side 结果统计由 Codex App host 负责。
