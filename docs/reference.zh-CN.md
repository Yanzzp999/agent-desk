# AgentDesk 参考

[English reference](reference.md)

这里放运行或扩展 AgentDesk 时有用、但不适合塞在 README 首页里的参考细节。运行行为细节见 [design.zh-CN.md](design.zh-CN.md)。

## Codex Skills

所有内置 skill 都只在显式点名时使用。

| Skill | 用途 |
| --- | --- |
| `generate-agentdesk-task` | 把显式用户需求转成 AgentDesk control-plane task。它会检查 brief 是否足以生成可执行的 `task.md`，阻塞信息缺失时先反问。 |
| `review-agentdesk-task` | 对 AgentDesk task 或 `task.md` 做实现前只读审查，重点找歧义、验收缺失、范围偏差，以及后续 agent 误解风险。 |
| `run-agentdesk-subagents` | 基于已有 task 启动或协调 Codex CLI / Codex App 子代理。配置的 parallelism 是最大上限，不要求用满。 |
| `claim-agentdesk-task` | 原子领取一个开放的 markdown checklist item，只实现这一项，并用同一个 assignee/session 身份完成它。 |

在执行子代理前，协调模型应先评审 task 复杂度和并发编辑冲突风险，决定推荐的每批 subagent 数量并告知用户。用户仍可在配置上限内自行选择不同的并发量。

## MCP Tools

| Tool | 用途 |
| --- | --- |
| `create_task` | 在 `<project>/task/` 下创建 markdown task 文件。 |
| `list_tasks` | 列出 `<project>/task/` 下的 markdown task 文件。 |
| `read_task` | 读取 `<project>/task/` 下的 markdown task 文件。 |
| `claim_task_items` | 给指定 checklist item 写入可见的 AgentDesk claim marker。 |
| `claim_next_task_item` | 原子领取第一个开放且未被领取的 checklist item，并把正在实现的 `agent -> sessionId` marker 写入 `task.md`。 |
| `complete_task_items` | 原子勾选同一个 assignee 和 session id 已领取的 item。 |
| `create_agentdesk_task` | 通过 Codex CLI 生成 `.agent-desk/tasks/<taskId>/task.md`；发现相似 task 时先返回清晰的恢复选项，避免重复创建。失败的相似 task 会保留日志，并在 `rebuild` 后关联到 replacement task。 |
| `list_agentdesk_tasks` | 从 `.agent-desk/tasks` 列出 AgentDesk control-plane task。 |
| `read_agentdesk_task` | 读取 control-plane task、生成的 `task.md`、共享 `memory.md` 和 session 摘要。 |
| `start_subagent_session` | 启动 Codex CLI session，或准备 Codex App launch plan。 |
| `list_subagent_sessions` | 从 `.agent-desk/sessions` 列出 AgentDesk sessions。 |
| `read_subagent_session` | 读取 session 状态、agent 摘要、文档、日志，以及可用时的 Codex App launch-plan 细节。 |

## Task 格式

Markdown task 文件使用 checkbox 子任务：

```md
# Checkout flow

## Goal

Implement the checkout flow end to end.

## Tasks

- [ ] Add payment state model
- [ ] Wire confirmation screen
```

领取 task item 时会在 checkbox 下写入可见归属 marker：

```md
- [ ] Implement API handler
  - AgentDesk claim: `agent-alpha` at 2026-05-22T10:00:00.000Z; session: `session-abc`; note: implementing
```

agent 应在实现前调用 `claim_next_task_item`，验证后调用 `complete_task_items`。

## 验证

常用检查：

```sh
npm test
./scripts/verunectl.sh help
codex --version
```

未来新增 UI/Web runtime 时，按仓库规则验证：先检查 dev server 是否已经运行，只有需要时才启动，并优先用 Computer Use 做本地 UI 验证。
