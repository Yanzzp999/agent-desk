# AgentDesk 双启动链路健康检查报告

生成时间：2026-05-25 21:10 CST

任务：`task-20260525T123804Z-dual-launcher-health-check-validation-project`
会话：`session-20260525T124014Z-health-check-validation-users-yanzzp-documents-agent-desk-agentdesk-next`
执行方式：`codex-cli` launcher，`parallelism=2`，请求 `executionMode=auto`，实际由 AgentDesk 选择 worktree 隔离。

## 总体结论

本轮健康检查不能标记为全绿。核心功能面大多有通过证据：`npm test`、关键 `verunectl` smoke、控制面 `tasks create/show`、`codex-cli` smoke、`codex-app` launch-plan handoff、任务领取/完成、session history、readable naming 和 MCP stdio live smoke 都通过或有可读证据。

阻断问题集中在 AgentDesk worktree 完成后的集成策略：当前实现仍会尝试把 subagent 结果集成并推送到 `master`，这违反本仓库 `AGENTS.md` 对 `agentdesk/next` 的工作流约束。

## Session 结果

| 项目 | 结果 |
| --- | --- |
| 总状态 | `failed` |
| agent 总数 | 10 |
| 成功 | 7 |
| 失败 | 3 |
| 运行/排队 | 0 |
| 主要失败原因 | `master` 集成/推送路径仍被触发 |

失败 agent：

- `agent-06`：完成并发风险说明后，AgentDesk post-run integration 尝试 `git push master`，远端以 non-fast-forward 拒绝。远端未被更新。
- `agent-09`：任务领取、session history、readable naming、MCP stdio、`verunectl` 功能验证通过，但因我临时移除 `master` upstream 以阻止后续 push，post-run integration 失败。
- `agent-10`：汇总报告已在子工作树生成并提交，但同样因 `master` upstream 被临时移除而未被旧集成逻辑合入。

## 已验证通过

| 验证项 | 证据 |
| --- | --- |
| 文档和禁止范围盘点 | `agents/agent-01/report.json` |
| 实现覆盖清单 | `agents/agent-03/report.json` |
| 全量测试 | 主 checkout 提权执行 `npm test`，79/79 通过 |
| CLI smoke | `agents/agent-04/report.json` |
| 控制面任务 create/show | `agents/agent-05/report.json` |
| `codex-cli` launcher | `agents/agent-07/report.json` |
| `codex-app` handoff | `agents/agent-08/report.json` |
| 任务领取、session history、readable naming、MCP stdio | `agents/agent-09/report.json` |

`codex-cli` smoke 结果：

- Smoke task：`task-20260525T124823Z-codex-cli-launcher-smoke-validation`
- Smoke session：`session-20260525T124852Z-verunectl-help-smoke-check`
- 结果：`succeeded`，1 个 agent 成功、0 失败
- 参数：`gpt-5.5`、`xhigh`、请求 `auto`、`parallel=1`
- 注意：用户态 `fast` 在 Codex CLI launch args 中映射为 `service_tier="priority"`

`codex-app` handoff 结果：

- Smoke session：`session-20260525T124934Z-codex-app-current-branch-smoke`
- 结果：launch plan 成功生成
- 状态：session 为 `waiting_for_app`，agent 为 `prepared_for_app`
- `requiresHostLaunch=true`，`launchTool=spawn_agent`
- 注意：CLI subagent 不能调用 Codex App host 的 `spawn_agent`，所以该项只证明 handoff/launch plan 正常，不证明 host-side subagent 已实际完成。

## 失败与风险

| ID | 问题 | 影响 | 建议优先级 |
| --- | --- | --- | --- |
| HCV-001 | worktree session 仍触发 `master` integration/push | 违反本仓库默认基线 `agentdesk/next`，也违反“不默认 push”约束 | P0 |
| HCV-002 | subagent worktree 基线与 `agentdesk/next` 不一致 | 影响“基于 agentdesk/next 验证”的可信度 | P0 |
| HCV-003 | `codex-app` 只验证到 handoff | 不能证明 App host 已真实执行并完成 subagent | P1 |
| HCV-004 | fresh worktree 未安装依赖时 CLI/MCP smoke 先失败 | 容易把环境准备问题误判为产品失败 | P2 |
| HCV-005 | `npm audit` 报告 transitive `qs` moderate advisory | 如 CI 把 audit 设为硬门禁会阻塞 | P2 |

## 本地修复动作

本轮运行中，AgentDesk 旧集成逻辑在 push 失败前已把本地 `master` ref 推进到 `ff61ad8...`。我已做以下收口修复：

- 恢复 `master` upstream 为 `origin/master`。
- 将本地 `master` ref 修回运行前的 `b86cb0047e3424871019730366e4ff3695b29184`。
- 确认当前 checkout 仍在 `agentdesk/next`。
- 确认远端 push 未成功，远端 `origin/master` 未被这次运行更新。

当前主 checkout 验证：

- `npm test`：提权执行通过，79/79。
- `git diff --check`：通过。

## 证据路径

- Session meta：`.agent-desk/sessions/session-20260525T124014Z-health-check-validation-users-yanzzp-documents-agent-desk-agentdesk-next/meta.json`
- Session 文档：`.agent-desk/sessions/session-20260525T124014Z-health-check-validation-users-yanzzp-documents-agent-desk-agentdesk-next/session.md`
- Agent 报告：`.agent-desk/sessions/session-20260525T124014Z-health-check-validation-users-yanzzp-documents-agent-desk-agentdesk-next/agents/<agent-id>/report.json`

## 建议下一步

1. 修正 `src/lib/control-plane.mjs` 中 worktree completion 的集成策略：在本仓库默认工作流下不得自动 rebase/advance/push `master`。
2. 明确区分 `fast` 用户语义和 Codex CLI 的实际 `service_tier="priority"` 映射，避免报告口径混乱。
3. 对 `codex-app` 增加 host-side smoke：由 Codex App host 使用 `spawn_agent` 接管 launch plan 并回写完成证据。
4. 在健康检查模板中把 `npm ci` 或依赖存在性检查设为 runtime smoke 前置条件。
