# Validate AgentDesk MCP functionality

## Goal

Verify that the AgentDesk MCP surface is healthy end to end: task file operations, checklist claiming, MCP resource exposure, and integration behavior expected by local AgentDesk workflows. Keep validation read-safe where possible and record any failures with reproduction steps.

## Tasks

- [x] Inventory the project's MCP-related entry points, server definitions, schemas, and documented commands.
  - AgentDesk claim: `codex-main` at 2026-05-14T06:08:04.260Z; note: Coordinating implementation, verification, tests, and final notes.
- [x] Verify the MCP server can be discovered and started from the local project configuration.
  - AgentDesk claim: `codex-main` at 2026-05-14T06:08:04.260Z; note: Coordinating implementation, verification, tests, and final notes.
- [x] Verify `list_tasks` returns existing task files without errors.
  - AgentDesk claim: `subagent-1` at 2026-05-14T06:08:57.023Z; note: Validating MCP happy path via list/create/read tools.
- [x] Verify `create_task` can create a new task file with title, brief, and checklist items.
  - AgentDesk claim: `subagent-1` at 2026-05-14T06:08:57.023Z; note: Validating MCP happy path via list/create/read tools.
- [x] Verify `read_task` can read a task by filename, title, and title slug.
  - AgentDesk claim: `subagent-1` at 2026-05-14T06:08:57.023Z; note: Validating MCP happy path via list/create/read tools.
- [x] Verify `claim_task_items` can claim checklist items by number and by unique title fragment.
  - AgentDesk claim: `subagent-2` at 2026-05-14T06:09:15.280Z; note: Subagent 2 validating claim_task_items selector behavior and persistence.
- [x] Verify claim markers are persisted in the markdown task file and remain readable by `read_task`.
  - AgentDesk claim: `subagent-2` at 2026-05-14T06:09:15.280Z; note: Subagent 2 validating claim_task_items selector behavior and persistence.
- [x] Verify resource listing, resource templates, and resource reading behavior for any resources exposed by the MCP server.
  - AgentDesk claim: `subagent-4` at 2026-05-14T06:09:05.981Z
- [x] Verify invalid inputs fail clearly without corrupting task files, including unknown task names and ambiguous checklist selectors.
  - AgentDesk claim: `subagent-3` at 2026-05-14T06:09:03.852Z; note: Validating negative inputs and repeated claim behavior.
- [x] Verify concurrent or repeated MCP calls do not duplicate claims unexpectedly or damage existing task content.
  - AgentDesk claim: `subagent-3` at 2026-05-14T06:09:03.852Z; note: Validating negative inputs and repeated claim behavior.
- [x] Run the project's automated tests that cover MCP behavior, or add focused coverage if no existing test exercises a critical MCP path.
  - AgentDesk claim: `codex-main` at 2026-05-14T06:08:04.260Z; note: Coordinating implementation, verification, tests, and final notes.
- [x] Manually smoke test the MCP workflow from the expected Codex/AgentDesk client path if automated coverage cannot cover it.
  - AgentDesk claim: `subagent-5` at 2026-05-14T06:09:00.276Z; note: MCP validation: scripts, entry points, tests, smoke start path
- [x] Document verified commands, observed outputs, failures, and follow-up fixes in this task file or linked notes.
  - AgentDesk claim: `codex-main` at 2026-05-14T06:08:04.260Z; note: Coordinating implementation, verification, tests, and final notes.

## Verification Results

Completed on 2026-05-14 with five parallel subagents plus main-session checks.

- MCP tools verified: `create_task`, `list_tasks`, `read_task`, and `claim_task_items`.
- Happy path passed: task creation, listing, and reading by filename, title, and slug.
- Claim path passed: item number selectors and unique title fragments write visible claim markers and remain readable through `read_task`.
- Negative path passed: unknown task names and ambiguous selectors fail clearly without mutating task files.
- Repeated/near-concurrent claim calls passed: existing claim lines are replaced rather than duplicated, and task content remains intact.
- Resource exposure verified: AgentDesk currently exposes no MCP resources or resource templates; this matches the tool-only server implementation.
- Startup paths passed: both `agent-desk-mcp --project <dir>` and `ralphctl mcp --project <dir>` start and expose the same four tools.
- Automated verification passed: `npm test` completed with 23 passing tests.
- Documentation follow-up completed: README MCP tools list now includes `claim_task_items`.
