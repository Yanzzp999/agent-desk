# AgentDesk

[English README](../README.md)

AgentDesk 是一个面向 Codex 工作流的本地 MCP / CLI 编排工具。它把工程目标变成 markdown checklist task，让 agent 在开始前先领取任务，运行 Codex 子代理，并把结果记录成可审计的项目 session。

```mermaid
flowchart LR
    goal["Engineering goal"] --> entry{"MCP / CLI entry"}
    entry --> task["Markdown checklist<br/>task.md"]

    task -. "Need help?" .-> tools["list / read / claim<br/>task items"]
    tools -. "Write claim marker" .-> task

    task --> executable{"Executable<br/>checkbox tasks?"}
    executable -- "No" --> stop["Stop execution<br/>report why fanout is unavailable"]
    executable -- "Yes" --> session["Start session<br/>dispatch Codex workers"]
    session --> done{"Agent succeeded?"}
    done -- "Failed" --> error["Record lastError<br/>in session metadata"]
    done -- "Succeeded" --> finalize["Finalize<br/>worktree integration to master"]
    error --> summary["Regenerate session.md<br/>latest execution summary"]
    finalize --> summary
    summary --> user["User reviews<br/>auditable status"]
```

## 是什么

AgentDesk 围绕三个对象工作：

- `Project`：任意本地 git 仓库。
- `Task`：生成出来的、带 checkbox 子任务的 `task.md`。
- `Session`：一次执行运行，把 task item 分发给 Codex CLI worker，或准备 Codex App launch plan。

agent 可以在实现前使用 `claim_next_task_item`；可见 marker 会记录 `agent -> sessionId`，让人和其他 agent 都能看到归属。在执行子代理前，协调模型应先评审 task 复杂度和并发编辑冲突风险，决定推荐的每批 subagent 数量并告知用户；用户仍可在配置上限内自行选择不同的并发量。

AgentDesk 目前没有 GUI、Electron app 或 web runtime。受支持入口是 MCP stdio 和 `verunectl`。

## 本地 MCP 注册

AgentDesk 目前从本地 checkout 运行。需要 Node.js 22.12 或更新版本，并且本机可执行 Codex CLI。

```sh
npm install
codex mcp add agent-desk -- node "$(pwd)/bin/agent-desk-mcp.mjs"
codex mcp get agent-desk
```

如果希望 MCP server 默认绑定到一个固定项目：

```sh
codex mcp add agent-desk-my-project \
  --env AGENT_DESK_PROJECT_ROOT=/absolute/path/to/your/project \
  -- node "$(pwd)/bin/agent-desk-mcp.mjs"
```

也可以通过本地 CLI 启动同一个 MCP server：

```sh
./scripts/verunectl.sh mcp --project /absolute/path/to/your/project
```

## 常用 CLI

创建 task：

```sh
./scripts/verunectl.sh tasks create \
  --project /absolute/path/to/project \
  --title "Checkout flow" \
  --brief "Implement the checkout flow end to end"
```

列出和查看 task：

```sh
./scripts/verunectl.sh tasks list --project /absolute/path/to/project
./scripts/verunectl.sh tasks show <taskId> --project /absolute/path/to/project
```

启动 session：

```sh
./scripts/verunectl.sh sessions start <taskId> \
  --project /absolute/path/to/project \
  --model gpt-5.5 \
  --reasoning xhigh \
  --parallel 6
```

常用 session 命令：

```sh
./scripts/verunectl.sh sessions list --project /absolute/path/to/project
./scripts/verunectl.sh sessions show <sessionId> --project /absolute/path/to/project
./scripts/verunectl.sh sessions logs <sessionId> <agentId> --project /absolute/path/to/project
```

默认值：模型 `gpt-5.5`、reasoning `xhigh`、service tier `fast`、execution mode `auto`、启动批次大小 `6`、最大并发 `6`。

`codex-cli` subagent 会作为可 resume 的交互式 Codex CLI session 启动。`sessions show` 和 `session.md` 会展示每个 agent 的 `codex resume --all <sessionId>` 命令；在原始 cwd 下，也可以用裸 `codex resume <sessionId>` 继续同一个会话。

## 状态目录

每个项目会把 AgentDesk 状态保存在项目内，持久化 worktree 则放在用户 home 目录下。

```text
<project>/task/
  <task-slug>.task.md

<project>/.agent-desk/
  tasks/
    <taskId>/
      brief.md
      prompt.md
      task.md
      memory.md
      meta.json
      stdout.log
      stderr.log
  sessions/
    <sessionId>/
      meta.json
      session.md
      stdout.log
      stderr.log
      agents/
        <agentId>/
          task.snapshot.md
          memory.snapshot.md
          prompt.md
          report.json
          stdout.log
          stderr.log

~/.agent-desk/worktrees/<project-key>/<sessionId>/<agentId>
```

`taskId` 和 `sessionId` 是路径、命令、worktree 和 MCP 查询里的稳定引用。`memory.md` 保存跨 session 共享的 task 上下文，`session.md` 会随着 agent 完成不断重新生成。

每个 CLI 运行的 agent 会在实现和验证完成后写入 `report.json`。agent metadata 也会记录只读字段 `codexSessionId`、`codexSessionPath` 和 `codexResumeCommand`，方便人工检查或继续会话。

详细 skills、MCP tools、task 格式和验证说明见 [reference.zh-CN.md](reference.zh-CN.md)。运行行为细节见 [design.zh-CN.md](design.zh-CN.md)。

## 开源协议

AgentDesk 使用 GNU General Public License v3.0 or later（`GPL-3.0-or-later`）发布。详情见 [LICENSE](../LICENSE)。
