---
id: full-verification-20260612
title: Full AgentDesk Feature Verification
priority: high
status: ready
type: verification
branch: agentdesk/next
effort: 1-2d
tags: [mcp, cli, sessions, overall-tasks, claiming, launchers, monitoring, regression]
---

# Full AgentDesk Feature & Regression Verification

**Verification Task for AgentDesk itself (self-hosted on this repo)**

Use the current project (agent-desk on `agentdesk/next`) to exercise and confirm **all major functionality** works correctly after updates (internal host-direct subagent launchers for codex/claude/grok, expanded monitoring via overall-tasks + session state + record flows, multi-launcher support, etc.).

**Important scope notes (for this task creation):**
- **Do NOT** use `verunectl tasks create` / `create_agentdesk_task` (Codex generation path) to produce *this* task.md. Create/register it via direct file + `materializeControlPlaneTask` or MCP `create_task` (simple checklist) + manual control-plane materialization. This allows independent testing of the generator in separate subtasks.
- Cover **both** project-level `task/*.task.md` (simple checklists + claims) **and** control-plane `.agent-desk/tasks/<id>/task.md` (full Goal/Context/AC + subtasks).
- Test **MCP stdio** as primary (via available integration or direct lib calls), `verunectl` CLI as full parallel path.
- Exercise **codex-cli** launcher (AgentDesk-owned external spawns) **and** at least one host-direct launcher (`codex-app` or `direct` / simulate for claude/grok via plan + record).
- Prefer `current-branch` + low parallelism for verification safety (no unnecessary worktrees unless explicitly testing isolation).
- All verification must leave artifacts (session docs, reports, memory, logs) for human review.
- Run on this checkout (`agentdesk/next`). Do not switch to master.

## Goal

Confirm that AgentDesk (MCP + CLI + control plane + claiming + subagent orchestration + overall task monitoring + config + history) is fully functional end-to-end. Produce clear pass/fail evidence + updated status in this task and any linked overall task. The task itself must remain human-readable while still being machine-actionable for subagents.

## Context

- Project: AgentDesk (this repo)
- Recent changes under test: default shift toward internal subagent launch (codex-app/claude-direct/grok-direct), generalized `isHostDirectLauncher`, launch plans with per-host `launchTool`, expanded monitoring instructions in skills, MCP/CLI enum+text updates, skills sync, Grok MCP installation for agent-desk.
- Dual usage: humans read for status/plan; subagents (or verifiers) claim + implement concrete items.
- Fake Codex / controlled execution preferred for determinism where possible (CODEX_CLI shim). Real Codex only for smoke.
- Monitoring surfaces: overall-tasks (SQLite + dispatch), `.agent-desk/sessions` + `session.md`, agent reports, task checklist sync, memory.md, logs.
- No frontend/Web UI validation required (beta, optional per AGENTS.md). Focus MCP/CLI/skills.

## Acceptance Criteria (Human + Testable)

- All MCP tools succeed with correct structured output and side effects (files, DB, state).
- Equivalent `verunectl` commands produce matching results.
- Subagent sessions complete successfully for both launcher types; host-direct ones properly use `appLaunchPlan` + `record_codex_app_subagent_result` (or generalized) to reach terminal status and sync checklists/memory.
- Overall task full lifecycle (create → claim → dispatch → linked agentdesk task/session) works and is visible in monitoring.
- Task claiming (project + overall + next-item atomic) works with visible markers and prevents races.
- Config (toml read/write/init), health/runtime capabilities, code-sessions listing, logs, and memory persistence all functional.
- Generated/used task.md files remain human-scannable (rich headings, tables for subtasks overview, frontmatter/metadata, detailed AC, notes/risks) while supporting agent fanout (checkboxes + optional `<!-- ad:parallel=N -->`).
- No regressions: parsing, similar-task handling, worktree vs current-branch decisions, parallelism caps + batching, exclusive subtasks, error paths + lastError, status transitions.
- Evidence left behind: session docs, agent reports (summary/tests_run/risks/notes + changed files), terminal session status, overall task audit entries.
- Verification run documented (commands, outputs, before/after states) in this task's progress or a linked report.

## Subtasks Overview (for quick human scan)

Use the detailed checkboxes below for claiming. High-level table for status at a glance.

| # | Area | Key Verification | Launcher/Mode | Human Evidence |
|---|------|------------------|---------------|----------------|
| 1-3 | Project task/ + claims | create/list/read/claim_next/complete via MCP + CLI fallback | N/A | Visible claim markers, counts, markdown updates |
| 4-5 | Control plane task | materialize or equivalent, list/read_agentdesk_task | N/A | Full Goal/Context/AC + subtasks present, subtaskCount correct |
| 6-8 | Subagent sessions | start (cli + host-direct), list/read (incl launchPlan), logs | codex-cli + codex-app/direct ; current-branch + auto | Terminal status, appLaunchPlan populated, record advances counts |
| 9-10 | Overall tasks + dispatch | full CRUD + claim + dispatch (links to agentdesk task/session) | N/A (triggers subagent if configured) | SQLite state, audit trail, linked session |
| 11-12 | Config, health, misc | config show/init, getHealth/runtime, code-sessions | N/A | Correct defaults, launcher lists include new direct ones |
| 13 | Monitoring & cross-cut | checklist sync, memory, reports, parallel hints, error paths | Mixed | Progress visible in task.md + sessions |
| 14 | Self-verification wrap | Summarize results, update this task status | N/A | All AC checked with links to artifacts |

## Detailed Subtasks (agent-claimable)

### Project-level task/ checklist flow (MCP primary)

- [ ] Create a simple project `task/` checklist task via MCP `create_task` (or equivalent direct write) with title "Verification checklist support" and 3-4 concrete items. Verify file created under `task/`, markdown uses `- [ ]`, and `list_tasks`/`read_task` return correct counts/open/claimed.
- [ ] Use `claim_next_task_item` (MCP) to atomically claim one, write visible "AgentDesk claim: ..." marker. Confirm `read_task` shows claimedBy + claimSessionId + timestamp. Test force overwrite path.
- [ ] Claim additional items with `claim_task_items`, then `complete_task_items` for the same assignee/session. Verify checkboxes update to `[x]`, claimed count decreases, and no cross-session completion allowed.
- [ ] Exercise equivalent flows via `verunectl` (if exposed) or direct lib calls for parity. Confirm human-readable markers in the .task.md.

### Control-plane AgentDesk tasks (.agent-desk layer)

- [ ] Manually author (or via simple MCP create_task + copy) a rich control-plane ready `task.md` (this verification document or a focused subset) with proper ## Goal / ## Context / ## Acceptance Criteria / ## Subtasks (mix of plain and with `<!-- ad:parallel=1 -->`). Use `materializeControlPlaneTask` (or equivalent) to register under `.agent-desk/tasks/<verification-task-id>/` with meta.json. Verify `list_agentdesk_tasks` and `read_agentdesk_task` surface correct subtaskCount, markdown, memoryPath, and sessions.
- [ ] Confirm the task reaches "ready" state without using the Codex generator path. Read full content (including any frontmatter or tables) and confirm parseMarkdownChecklist + parseTaskMarkdownItems correctly extract titles + parallel hints.

### Subagent session orchestration — codex-cli launcher

- [ ] Call `start_subagent_session` (MCP) or `verunectl sessions start` with a ready taskId, `subagentLauncher: "codex-cli"`, `executionMode: "current-branch"` (or auto that picks it), parallelism=2, model defaults. Wait for completion (or poll). Verify session status → succeeded/failed, agents have reports written, task checklist items marked with "AgentDesk status: `succeeded`..." annotations, memory entries created, stdout/stderr logs populated, `read_subagent_session` and `read_subagent_logs` return usable content. Confirm Codex CLI args (if faked or real) honored model/reasoning/service_tier.
- [ ] Repeat or extend with worktree mode (explicit), higher parallelism cap (respecting MAX), launchPrompt, and `waitForCompletion: false` + later poll. Verify worktree created under worktreesRoot (if used), branch integration (agent-branch default), changedFiles captured.
- [ ] Test error path (e.g. bad subtask that causes failure) — session ends failed, lastError set, failedAgents count >0, partial checklist updates, no crash.

### Subagent session orchestration — host-direct / internal launchers (codex-app + generalized)

- [ ] Start session with `subagentLauncher: "codex-app"` (or "direct"), executionMode current-branch. Confirm immediate return with `requiresHostLaunch: true`, populated `appLaunchPlan` (subagents list with promptPath/prompt/model/reasoning, launchTool appropriate for launcher).
- [ ] "Host" side simulation (in this verification): for 1-2 agents, use the prepared prompt + write a minimal valid report.json (summary, tests_run, risks, notes), then call `record_codex_app_subagent_result` with status succeeded + report + optional changedFiles/codexSession*. Verify session moves out of waiting_for_app, counts update, checklist syncs, memory persisted, final status succeeded if all good. Repeat for a failure case.
- [ ] Confirm new launchers (`claude-direct`, `grok-direct`) are accepted in schema/normalize, produce requiresHostLaunch + sensible launchTool in plan, and route to same record path (no "only for codex-app" errors).
- [ ] Verify `list_subagent_sessions` / `read_subagent_session` surface launcher, requiresHostLaunch, and appLaunchPlan for direct ones (0 succeeded until records arrive).

### Overall tasks + monitoring layer + dispatch bridge

- [ ] Create overall task (via MCP `create_overall_task` or verunectl) with taskType coding, projectRoot this dir, period day. Claim it. Update status/priority/assignee.
- [ ] Use `dispatch_overall_task` (with or without agentdeskTaskId). Verify dispatch recorded, audit trail in overall task, and if it triggers control-plane task materialization + optional session start.
- [ ] `breakdownOverallTask` (if exercised) produces usable subtasks. List/read overall shows linked sessions/claims.
- [ ] Confirm monitoring works across: overall list filtered by status/period, session list by taskId, health includes counts + runtime capabilities (launcher lists now include new direct ones), code-sessions list recent (if any codex activity).

### Config, runtime, health, misc + cross-cutting

- [ ] `verunectl config show` / readAgentDeskConfig, `config init --force`. Verify toml roundtrips session defaults (model, reasoning, subagent_launcher=..., parallelism, execution_mode). Confirm new launcher values are valid.
- [ ] Call health / getRuntimeCapabilities. Verify runtime lists supported launchers, currentBranchSubagentLaunchers includes codex-app + new directs, defaults reflect internal preference for current-branch.
- [ ] Exercise `read_subagent_logs`, agent report JSON schema validation (via normalizeSubagentReport), memory snapshot write/read, subtask parallel annotation parsing in context of a real session.
- [ ] Test similar-task confirmation path on create_agentdesk_task (or equivalent) if exercised in a sub-verification.
- [ ] Confirm no breakage in existing parsers (parseTaskMarkdownItems, checklist with [x]/[ ], legacy claim markers).

### Wrap-up & evidence collection (human + agent)

- [ ] Collect and link artifacts: all created task/*.task.md and .agent-desk/tasks/.../task.md + meta + memory + session dirs (with session.md, agents/*/report.json + logs), overall task IDs, verunectl/MCP command outputs (json mode preferred), health snapshots before/after.
- [ ] Update this task's checkboxes + any "AgentDesk status" annotations. If using an overall task for tracking, dispatch/update it with summary.
- [ ] Produce a short human summary in this task (or a docs/ verification report): which paths passed, any gaps, commands to reproduce, confirmation that task.md stayed human-readable (tables, frontmatter, detailed sections) while supporting full agent fanout + claiming.
- [ ] (Optional but recommended) Sync skills if any doc changes, run a final `npm test` + key CLI smokes as part of evidence.

## Risks & Dependencies

- Real Codex usage costs quota — prefer shims/fakes for most paths; limit real `--version` or one small smoke.
- Worktree creation modifies filesystem — stick to current-branch for most verification items.
- Claiming is stateful and uses locks — run sequentially or with distinct assignees/sessions.
- Multi-launcher support is recent — focus regression on record flows and launcher normalization.
- This task document must itself be a good example of human + machine readable format (frontmatter, overview table, rich narrative AC, concrete subtasks).

## Verification Steps (for the person or coordinating agent running this)

1. Ensure on `agentdesk/next`, clean working tree or intentional state.
2. Register this task (direct + materialize as noted).
3. Exercise items in order or by priority (claims first for isolation).
4. After each major area, `read_*` + `list_*` + inspect files on disk.
5. For host-direct: manually "play host" by calling record with plausible report after "running" the prompt (or use a subagent if in supporting environment).
6. At end: run `npm test`, key `node bin/verunectl.mjs ... --json` smokes, capture outputs.
7. Mark complete only after all evidence reviewed and this document updated.

## Notes for Humans

This task.md is intentionally richer than minimal generated ones:
- YAML frontmatter for quick metadata scan (id, priority, tags, branch).
- Narrative Goal + Context + detailed AC (testable bullets).
- Overview table for at-a-glance status (humans love tables).
- Detailed subtasks with context so a human reviewer understands intent without reading every agent prompt.
- Explicit instructions to keep the doc itself as an example of the "better for humans" format discussed in analysis (while remaining 100% compatible with existing parsers, claim markers, and subtask fanout).
- Artifacts and commands emphasized so a human can audit without re-running everything.

Subagents should treat only the `- [ ]` items as ownable work. Coordinator duties (this summary, final evidence aggregation) stay in the main flow.

---

**Ready for claiming and execution.** Use `claim_next_task_item` or equivalent to pick up work. Update progress visibly.

(End of task document — keep this file as both the spec and the living verification log.)