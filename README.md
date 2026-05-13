# AgentDesk

Standalone Ralph control plane for inspecting planner jobs and `ralph-run`
execution state from a separate repository.

The app stays intentionally thin:

- `.ralph/` in the target project remains the source of truth for run state.
- `.ralph-ui/` in the target project stores planner job metadata.
- Existing Ralph scripts still do the real orchestration work.
- The desktop app embeds a local control-plane server on `127.0.0.1:4317`
  by default.

## Quick Start

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

AgentDesk opens as a macOS desktop window. Choose the Ralph project you want
to inspect inside the app.

You can also use the wrapper script:

```sh
./scripts/ralphctl.sh gui
./scripts/ralphctl.sh runs list --project /absolute/path/to/your/ralph-project
./scripts/ralphctl.sh planner list --project /absolute/path/to/your/ralph-project
```

## CLI

```text
ralphctl dev
ralphctl gui
ralphctl gui open
ralphctl serve
ralphctl runs list
ralphctl runs show <runId>
ralphctl runs current
ralphctl runs collect <runId>
ralphctl tasks logs <runId> <taskId>
ralphctl tasks retry <runId> <taskId>
ralphctl tasks stop <runId> <taskId>
ralphctl planner start --brief "Build ..."
ralphctl planner start --input tasks/prd-example.md
ralphctl planner list
ralphctl planner show <planJobId>
ralphctl planner logs <planJobId>
```

Every read command accepts `--json`. The desktop app can start without a
project and lets you choose one in the app. Use `--project DIR` for CLI read
commands, or to preselect a project when launching the desktop app or web
server.

`ralphctl serve` keeps the browser-based local web server available for
debugging or remote inspection. `ralphctl gui` and `npm run dev` launch the
desktop window.

## Ralph Script Resolution

AgentDesk looks for Ralph scripts in this order:

1. `RALPH_RUN_CLI` or `RALPH_PLAN_CLI`
2. `RALPH_SKILLS_ROOT`
3. `<project>/skills`
4. `<project>/.codex/skills`
5. `<project>/.gemini/skills`
6. `<project>/.claude/skills`
7. `<agent-desk>/../skills`
8. `~/.codex/skills`
9. `~/.gemini/skills`
10. `~/.claude/skills`

That makes it work with repo-local and user-level synced skills across Codex
CLI, Gemini CLI, and Claude Code setups.

## API

Core endpoints:

```text
GET  /api/health
GET  /api/runs
GET  /api/runs/current
GET  /api/runs/:runId
POST /api/runs/:runId/collect
GET  /api/runs/:runId/tasks/:taskId
GET  /api/runs/:runId/tasks/:taskId/logs?lines=200
GET  /api/runs/:runId/tasks/:taskId/result
POST /api/runs/:runId/tasks/:taskId/retry
POST /api/runs/:runId/tasks/:taskId/stop
GET  /api/plans
POST /api/plans
GET  /api/plans/:planJobId
GET  /api/plans/:planJobId/logs
GET  /api/artifacts
GET  /api/artifacts/preview?path=/abs/path
GET  /api/events
```

## Verification

```sh
npm test
```
