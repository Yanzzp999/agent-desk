# AgentDesk CLI-only 编排

## 目标

取消 AgentDesk 的 GUI/Web 应用入口，把项目收敛成一个 CLI-first 工具，用来：

- 为选中的项目创建并保存 `task.md`
- 基于 `task.md` 启动 Codex CLI 子代理
- 允许用户配置子代理模型、思考深度和并发 Codex CLI 数量
- 在确认完整任务到 session 流程通过验证后，才把任务视为完成

## 初始上下文

AgentDesk 已经有 CLI 入口 `bin/ralphctl.mjs`，核心编排逻辑在
`src/lib/control-plane.mjs`。

核心 session 元数据已经保存 `model`、`reasoning`、`serviceTier` 和
`parallelism`，`runCodexPrompt` 也会把模型、思考深度和服务层级传给
`codex exec`。

改造前项目仍然包含 GUI/Web 路径：

- `npm run dev` 和 `npm run gui` 会启动 Electron
- `ralphctl dev`、`ralphctl gui` 和 `ralphctl serve` 暴露 GUI/Server 流程
- `src/desktop`、`src/web` 和 `src/server` 实现桌面/Web UI
- `README.md` 仍然记录 GUI/Server 使用方式

CLI 改造前只通过 `ralphctl sessions start <taskId> --parallel N` 暴露并发配置，
还没有在文档化的 CLI 流程里暴露模型和思考深度参数。

## 实现总结

AgentDesk 当前已经从支持的产品入口上变成 CLI-only：

- `package.json` 使用 `bin/ralphctl.mjs` 作为包入口，并且只保留 `test` npm script。
- `package.json` 和 `package-lock.json` 已移除 Electron。
- 已删除 `src/desktop`、`src/web` 和 `src/server` 下的 GUI/Web/Server 源文件。
- 已删除 `ralphctl dev`、`ralphctl gui` 和 `ralphctl serve`。
- `ralphctl sessions start` 已支持 `--model`、`--reasoning`、`--parallel`、`--concurrency` 和 `--codex-count`。
- `--codex-cli` 可以覆盖 Codex CLI 可执行文件路径，方便本地安装路径和确定性测试。
- Session 配置会被标准化、校验、持久化、写入 `session.md`、写入子代理 prompt，并传给 `codex exec`。
- `README.md` 已更新为中文 CLI-only 工作流和默认配置说明。

## 验收标准

- 项目不再依赖 Electron，正常使用不需要 GUI 或 Web Server。
- `ralphctl` 是主要支持的使用入口。
- 用户可以通过 CLI 创建/生成任务，并查看生成的 `task.md`。
- 用户可以通过 CLI 启动 session，并配置：
  - 模型，默认 `gpt-5.5`
  - 思考深度，默认 `xhigh`
  - 并发 Codex CLI 数量，默认 `6`
  - 服务层级固定为 `fast`
- Session 元数据、session 文档和子代理 prompt 都清楚记录所选模型、思考深度、服务层级和并发数量。
- 保留现有状态目录布局：`.agent-desk/tasks` 和 `.agent-desk/sessions`。
- 保留从 markdown checkbox 子任务 fanout Codex 子代理的能力。
- 执行路径只围绕 Codex CLI，不重新引入 `prd.json`、Gemini CLI 或 Claude Code 兼容层。
- 自动化测试覆盖 CLI 参数处理、session 配置持久化、Codex CLI 调用参数和任务 markdown 解析。
- 使用 fake Codex CLI 做确定性验证，证明任务生成和 session fanout 能在不消耗真实模型调用的情况下通过。
- 最后确认真实 `codex` 可执行文件可以解析并输出版本。

## 子任务

- [x] 从支持的产品入口中移除 GUI/Web 命令、脚本、依赖和文档。
- [x] 保留或重构可复用编排逻辑，使 CLI 可以在没有 Server/UI 的情况下创建任务、列出/查看任务、启动 session、查看 session 和读取 agent 日志。
- [x] 为 session start 增加 CLI 配置参数：`--model`、`--reasoning` 和 `--parallel`，并提供等价的并发 Codex CLI 数量别名。
- [x] 确保模型、思考深度、服务层级和并发数量会被校验、标准化、持久化、写入 `session.md`，并传给每个 Codex 子代理调用。
- [x] 增加测试覆盖 CLI 参数/config 传播、`codex exec` 参数构造、任务 markdown 解析和 session 文档渲染。
- [x] 增加确定性的 fake Codex CLI 端到端验证 fixture，让它写入预期 `task.md` 和子代理 report。
- [x] 更新 `README.md`，说明 CLI-only 工作流和默认值：`gpt-5.5`、`xhigh`、`fast`、每批启动 6 个，以及集成到 `master`。
- [x] 运行验证，把精确命令和结果记录到这里，再视为完成。

## 验证计划

1. 运行单元测试：`npm test`。
2. 运行 CLI help 和命令 smoke check：
   - `./scripts/ralphctl.sh help`
   - `./scripts/ralphctl.sh tasks list --project <fixture-project>`
   - `./scripts/ralphctl.sh sessions list --project <fixture-project>`
3. 运行 fake Codex 端到端任务生成验证：
   - 将 `CODEX_CLI` 或 `CODEX_CLI_PATH` 指向本地 shim
   - 创建一个带 `master` 分支的临时 git 项目
   - 运行 `ralphctl tasks create --title ... --brief ... --project <fixture-project>`
   - 等待 `.agent-desk/tasks/<taskId>/task.md`
   - 断言任务状态变为 `ready`
4. 运行 fake Codex 端到端 session 验证：
   - 用非默认配置启动 session，例如 `--model gpt-5.5 --reasoning high --parallel 2`
   - 断言 session 元数据记录了所选配置
   - 断言子代理 prompt 文件包含所选模型和思考深度
   - 断言 fake Codex shim 收到了 `codex exec -m <model> -c model_reasoning_effort="<reasoning>" -c service_tier="fast"`
   - 断言同时运行的 Codex CLI 数量不超过配置值
5. 在可用时运行真实 Codex smoke check：`codex --version`。

## 验证结果

- `npm test`：通过，16 个测试全部通过。
- `./scripts/ralphctl.sh help`：通过；help 输出只包含 CLI task/session 命令，并记录了 `--model`、`--reasoning`、`--parallel`、`--concurrency` 和 `--codex-count`。
- `./scripts/ralphctl.sh tasks list --project /Users/yanzzp/Documents/CodeProjects/agent-desk`：通过，返回 `No AgentDesk tasks found.`
- `./scripts/ralphctl.sh sessions list --project /Users/yanzzp/Documents/CodeProjects/agent-desk`：通过，返回 `No AgentDesk sessions found.`
- 确定性 fake Codex E2E：已在 `test/cli-orchestration.test.mjs` 中通过。
  - 创建临时 git 项目并使用 `master` 分支。
  - 通过 fake `CODEX_CLI` 运行 `ralphctl tasks create`。
  - 确认生成的 `task.md` 状态变成 `ready`，并包含 3 个子任务。
  - 运行 `ralphctl sessions start <taskId> --model gpt-5.5 --reasoning high --parallel 2`。
  - 确认 session 元数据记录模型 `gpt-5.5`、思考深度 `high`、服务层级 `fast`、并发数量 `2`、批次大小 `6`，并且 3 个 agent 全部成功。
  - 确认每个子代理 prompt 都包含所选模型和思考深度。
  - 确认 fake Codex 收到 `codex exec -m gpt-5.5 -c model_reasoning_effort="high" -c service_tier="fast"`。
  - 确认观测到的最大并发 fake Codex 执行数量正好是 `2`。
- `codex --version`：通过，输出 `codex-cli 0.130.0`。

## 进度日志

- 2026-05-13：在改代码前先起草任务文档。仓库当时已有本地修改：`src/lib/code-sessions.mjs`、`src/server/server.mjs`、`src/web/app.js`、`src/web/styles.css` 和 `test/code-sessions.test.mjs`；除非它们明确属于 CLI-only 迁移，否则需要保留。
- 2026-05-13：完成 CLI-only 迁移，移除支持的 GUI/Web 产品面，增加 session 配置参数和校验，增加 fake Codex E2E 覆盖，并验证所有测试和 CLI smoke check。
- 2026-05-13：按要求将 `README.md` 和 `task.md` 改成中文文档。
