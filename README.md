# AgentDesk

[中文说明](docs/README.zh-CN.md)

AgentDesk is a local MCP and CLI orchestrator for Codex work. It turns an engineering goal into a markdown checklist task, lets agents claim work before they start, runs Codex subagents, and records the result as an auditable project session.

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
    done -- "Succeeded" --> finalize["Finalize<br/>worktree branch<br/>or configured integration"]
    error --> summary["Regenerate session.md<br/>latest execution summary"]
    finalize --> summary
    summary --> user["User reviews<br/>auditable status"]
```

## What It Is

AgentDesk is built around three objects:

- `Project`: any local git repository.
- `Task`: a generated `task.md` with checkbox subtasks.
- `Session`: one execution run that fans out task items to Codex CLI workers or prepares a Codex App launch plan.

Agents can use `claim_next_task_item` before implementation; the visible marker records `agent -> sessionId` so people and other agents can see ownership. Before subagent execution, the coordinating model should review task complexity and concurrent-edit conflict risk, choose a recommended per-batch subagent count, and tell the user; the user can still choose a different concurrency value within the configured maximum.

The default AgentDesk usage path is the bundled Codex skills plus MCP/CLI: generate or read a `task.md`, claim checklist work, run or prepare subagent sessions, and review session history through `verunectl` or the MCP stdio server.

AgentDesk also includes an optional beta local React/Vite/TypeScript task management UI. The web runtime serves the same task.md, MCP stdio, `verunectl`, session history, and Codex subagent orchestration model, but it is not required for normal AgentDesk usage. It is not an Electron shell, Next.js app, or legacy compatibility surface.

## Local MCP Setup

AgentDesk currently runs from a local checkout. It requires Node.js 22.12 or newer and a working Codex CLI.

```sh
npm install
codex mcp add agent-desk -- node "$(pwd)/bin/agent-desk-mcp.mjs"
codex mcp get agent-desk
```

To bind the MCP server to a fixed project:

```sh
codex mcp add agent-desk-my-project \
  --env AGENT_DESK_PROJECT_ROOT=/absolute/path/to/your/project \
  -- node "$(pwd)/bin/agent-desk-mcp.mjs"
```

You can also start the same MCP server through the local CLI:

```sh
./scripts/verunectl.sh mcp --project /absolute/path/to/your/project
```

## Beta Local Web UI

The optional beta web UI opens directly on task management. It includes day/week/month planning, filters, an overall task list, task detail, create/edit form, claim and dispatch actions, coding `projectRoot` validation, and recent session summaries.

Start the local SQLite-backed API first, then run Vite:

```sh
./scripts/verunectl.sh api --project /absolute/path/to/project
npm run dev
```

Or start both processes with one command:

```sh
npm run dev:all -- --project /absolute/path/to/project
```

Vite serves the app at `http://127.0.0.1:5173` by default. During development it proxies `/api/agentdesk` to the Node.js ESM HTTP API at `http://127.0.0.1:19731`; the API stores overall task metadata, period assignment, claim/dispatch state, and audit events in the user-level `~/.agent-desk/tasks.sqlite` by default. Pass `--sqlite-path <file>` to override it for a run.

Expected local API routes:

- `GET /api/agentdesk/tasks`
- `GET /api/agentdesk/tasks/:taskId`
- `POST /api/agentdesk/tasks`
- `PATCH /api/agentdesk/tasks/:taskId`
- `POST /api/agentdesk/tasks/:taskId/claim`
- `POST /api/agentdesk/tasks/:taskId/dispatch`
- `GET /api/agentdesk/sessions/recent`

Overall tasks can be user-level (`projectRoot` empty) or project-bound (`projectRoot` absolute). Coding tasks require a project root before dispatch; project-filtered views include matching project tasks plus user-level planning tasks. Task and session dispatch keeps the documented defaults of model `gpt-5.5`, reasoning `xhigh`, service tier `fast`, and launch batch size `6`.

Frontend checks:

```sh
npm run test:web
npm run build
```

Only use these checks for changes that touch the beta web UI or its runtime. When validating `npm run dev`, first reuse an already-running dev server when one is reachable. Use Computer Use to inspect the running UI; only use browser-based validation when explicitly requested or when Computer Use is unavailable.

## Common CLI

Create a task:

```sh
./scripts/verunectl.sh tasks create \
  --project /absolute/path/to/project \
  --title "Checkout flow" \
  --brief "Implement the checkout flow end to end"
```

List and inspect tasks:

```sh
./scripts/verunectl.sh tasks list --project /absolute/path/to/project
./scripts/verunectl.sh tasks show <taskId> --project /absolute/path/to/project
```

Start a session:

```sh
./scripts/verunectl.sh sessions start <taskId> \
  --project /absolute/path/to/project \
  --model gpt-5.5 \
  --reasoning xhigh \
  --parallel 6
```

Useful session commands:

```sh
./scripts/verunectl.sh sessions list --project /absolute/path/to/project
./scripts/verunectl.sh sessions show <sessionId> --project /absolute/path/to/project
./scripts/verunectl.sh sessions logs <sessionId> <agentId> --project /absolute/path/to/project
```

Defaults: model `gpt-5.5`, reasoning `xhigh`, service tier `fast`, execution mode `auto`, launch batch size `6`, and maximum parallelism `6`.

`codex-cli` subagents are launched as resumable interactive Codex CLI sessions. `sessions show` and `session.md` include each agent's primary `codex resume <sessionId>` command, plus `codex resume --all <sessionId>` for resuming from another working directory.

## State Layout

Each project stores AgentDesk state inside the project, while persistent worktrees live under the user home directory.

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

`taskId` and `sessionId` are stable references for paths, commands, worktrees, and MCP lookups. `memory.md` preserves shared task context across sessions, and `session.md` is regenerated as agents finish.

Each CLI-run agent writes `report.json` when implementation and validation are complete. Agent metadata also records `codexSessionId`, `codexSessionPath`, `codexResumeCommand`, and `codexResumeAllCommand` for read-only inspection and manual continuation.

Detailed skills, MCP tools, task format, and verification notes are in [docs/reference.md](docs/reference.md). Runtime behavior details are in [docs/design.md](docs/design.md).

## License

AgentDesk is licensed under the GNU General Public License v3.0 or later (`GPL-3.0-or-later`). See [LICENSE](LICENSE) for details.
