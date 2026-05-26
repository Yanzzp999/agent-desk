#!/usr/bin/env node
import process from "node:process";
import { startAgentDeskMcpServer } from "../src/lib/mcp-server.mjs";
import {
  createContext,
  createSession,
  createTask,
  formatTable,
  getAgentLogs,
  getCodexAppLaunchPlan,
  readAgentDeskConfig,
  getSession,
  getTask,
  listSessions,
  listTasks,
  writeDefaultAgentDeskConfig,
} from "../src/lib/control-plane.mjs";
import {
  claimOverallTask,
  createOverallTask,
  dispatchOverallTask,
  getOverallTask,
  listOverallTasks,
  updateOverallTask,
} from "../src/lib/overall-tasks.mjs";

const VALUE_OPTIONS = new Set([
  "codex-cli",
  "codex-count",
  "config",
  "concurrency",
  "desk-root",
  "effort",
  "execution-mode",
  "mode",
  "model",
  "parallel",
  "parallelism",
  "project",
  "reasoning",
  "service-tier",
  "subagent-launcher",
  "task",
  "title",
  "brief",
  "agentdesk-task",
  "actor",
  "api-base-path",
  "assignee",
  "base-branch",
  "branch",
  "date",
  "description",
  "dispatch-target",
  "host",
  "note",
  "owner",
  "period",
  "period-key",
  "period-type",
  "port",
  "priority",
  "q",
  "query",
  "session",
  "sqlite",
  "sqlite-path",
  "static-dir",
  "status",
  "task-type",
  "worktree-integration",
  "worktrees-root",
]);

main().catch((error) => {
  if (wantsJsonOutput(process.argv.slice(2))) {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: "VERUNECTL_ERROR",
        message: error.message,
      },
    }, null, 2));
  } else {
    console.error(`verunectl: ${error.message}`);
  }
  process.exit(1);
});

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed._[0] || "help";

  if (parsed.help || command === "help") {
    printHelp();
    return;
  }

  if (command === "mcp") {
    await startAgentDeskMcpServer({
      projectRoot: parsed.project,
      taskStoreDbPath: parsed.sqlite || parsed["sqlite-path"],
    });
    return;
  }

  const context = createContext({
    projectRoot: parsed.project,
    deskRoot: parsed["desk-root"],
    worktreesRoot: parsed["worktrees-root"],
    configPath: parsed.config,
    codexCli: parsed["codex-cli"],
    taskStoreDbPath: parsed.sqlite || parsed["sqlite-path"],
  });

  if (command === "tasks") {
    await handleTasks(context, parsed);
    return;
  }

  if (command === "overall-tasks") {
    await handleOverallTasks(context, parsed);
    return;
  }

  if (command === "sessions") {
    await handleSessions(context, parsed);
    return;
  }

  if (command === "api") {
    await handleApi(context, parsed);
    return;
  }

  if (command === "config") {
    await handleConfig(context, parsed);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

async function handleConfig(context, parsed) {
  const subcommand = parsed._[1] || "show";
  if (subcommand === "show") {
    const result = await readAgentDeskConfig(context);
    return output(parsed, result, () => result.exists
      ? result.text.trimEnd()
      : `${result.text.trimEnd()}\n\n# Not written yet. Run: verunectl config init`);
  }
  if (subcommand === "init") {
    const result = await writeDefaultAgentDeskConfig(context, { force: Boolean(parsed.force) });
    return output(parsed, result, () => `Wrote AgentDesk config: ${result.path}`);
  }
  throw new Error(`unknown config command: ${subcommand}`);
}

async function handleTasks(context, parsed) {
  const subcommand = parsed._[1] || "list";
  if (subcommand === "list") {
    const result = await listTasks(context);
    return output(parsed, result, () => {
      if (result.items.length === 0) {
        return "No AgentDesk tasks found.";
      }
      return formatTable(result.items, [
        { header: "NAME", value: (row) => row.name || row.title || row.taskId, maxWidth: 36 },
        { header: "TASK ID", value: (row) => row.taskId, maxWidth: 44 },
        { header: "STATUS", value: (row) => row.status, maxWidth: 14 },
        { header: "SUBTASKS", value: (row) => row.subtaskCount, maxWidth: 10 },
        { header: "SESSIONS", value: (row) => row.sessionCount, maxWidth: 10 },
        { header: "UPDATED", value: (row) => row.updatedAt || "-", maxWidth: 24 },
      ]);
    });
  }
  if (subcommand === "show") {
    const taskId = required(parsed._[2], "task id");
    const result = await getTask(context, taskId);
    return output(parsed, result, () => {
      return [
        `Task: ${result.name || result.title || result.taskId}`,
        `Task ID: ${result.taskId}`,
        `Status: ${result.status}`,
        `Subtasks: ${result.subtaskCount || 0}`,
        `Sessions: ${result.sessions?.length || 0}`,
        "",
        result.markdown || "(empty task.md)",
        "",
        "## Memory",
        "",
        result.memory || "(empty memory.md)",
      ].join("\n");
    });
  }
  if (subcommand === "create") {
    const title = parsed.title || "";
    const brief = parsed.brief || await readStdinIfAvailable();
    const result = await createTask(context, {
      title,
      brief,
      similarTaskAction: taskCreateAction(parsed),
    });
    return output(parsed, result, () => renderTaskCreateResult(result));
  }
  throw new Error(`unknown tasks command: ${subcommand}`);
}

async function handleOverallTasks(context, parsed) {
  const subcommand = parsed._[1] || "list";
  if (subcommand === "list") {
    const result = await listOverallTasks(context, {
      ...(parsed.project ? { projectRoot: parsed.project } : {}),
      periodType: parsed["period-type"] || parsed.period,
      periodKey: parsed["period-key"],
      date: parsed.date,
      status: parsed.status,
      assignee: parsed.assignee || parsed.owner,
      q: parsed.q || parsed.query,
    });
    return output(parsed, result, () => {
      if (result.items.length === 0) {
        return "No overall tasks found.";
      }
      return formatTable(result.items, [
        { header: "TITLE", value: (row) => row.title, maxWidth: 36 },
        { header: "OVERALL TASK ID", value: (row) => row.overallTaskId, maxWidth: 46 },
        { header: "PERIOD", value: (row) => `${row.periodType}:${row.periodKey}`, maxWidth: 18 },
        { header: "STATUS", value: (row) => row.status, maxWidth: 12 },
        { header: "ASSIGNEE", value: (row) => row.assignee || row.claim?.claimedBy || "-", maxWidth: 16 },
        { header: "UPDATED", value: (row) => row.updatedAt || "-", maxWidth: 24 },
      ]);
    });
  }
  if (subcommand === "show") {
    const overallTaskId = required(parsed._[2], "overall task id");
    const result = await getOverallTask(context, overallTaskId);
    return output(parsed, result, () => renderOverallTask(result.task));
  }
  if (subcommand === "create") {
    const result = await createOverallTask(context, {
      title: parsed.title,
      description: parsed.description || parsed.brief,
      taskType: parsed["task-type"] || parsed.taskType || "coding",
      periodType: parsed["period-type"] || parsed.period || "day",
      periodKey: parsed["period-key"],
      date: parsed.date,
      status: parsed.status || "ready",
      priority: parsed.priority || "normal",
      assignee: parsed.assignee || parsed.owner,
      ...(parsed.project ? { projectRoot: parsed.project } : {}),
      branch: parsed.branch,
      actor: parsed.actor || parsed.owner || parsed.assignee,
      sessionId: parsed.session,
    });
    return output(parsed, result, () => `Created overall task: ${result.task.title} (${result.task.overallTaskId})`);
  }
  if (subcommand === "update") {
    const overallTaskId = required(parsed._[2], "overall task id");
    const result = await updateOverallTask(context, overallTaskId, {
      title: parsed.title,
      description: parsed.description || parsed.brief,
      taskType: parsed["task-type"] || parsed.taskType,
      periodType: parsed["period-type"] || parsed.period,
      periodKey: parsed["period-key"],
      date: parsed.date,
      status: parsed.status,
      priority: parsed.priority,
      assignee: parsed.assignee || parsed.owner,
      ...(parsed.project ? { projectRoot: parsed.project } : {}),
      branch: parsed.branch,
      actor: parsed.actor || parsed.owner || parsed.assignee,
      sessionId: parsed.session,
    });
    return output(parsed, result, () => `Updated overall task: ${result.task.title} (${result.task.overallTaskId})`);
  }
  if (subcommand === "claim") {
    const overallTaskId = required(parsed._[2], "overall task id");
    const result = await claimOverallTask(context, overallTaskId, {
      assignee: parsed.assignee || parsed.owner,
      sessionId: parsed.session,
      note: parsed.note,
      force: Boolean(parsed.force),
    });
    return output(parsed, result, () => `Claimed overall task: ${result.task.title} -> ${result.task.assignee}`);
  }
  if (subcommand === "dispatch") {
    const overallTaskId = required(parsed._[2], "overall task id");
    const result = await dispatchOverallTask(context, overallTaskId, {
      assignee: parsed.assignee || parsed.owner,
      sessionId: parsed.session,
      branch: parsed.branch,
      target: parsed["dispatch-target"],
      agentdeskTaskId: parsed["agentdesk-task"],
      note: parsed.note,
      force: Boolean(parsed.force),
    });
    return output(parsed, result, () => `Dispatched overall task: ${result.task.title} (${result.task.overallTaskId})`);
  }
  throw new Error(`unknown overall-tasks command: ${subcommand}`);
}

async function handleSessions(context, parsed) {
  const subcommand = parsed._[1] || "list";
  if (subcommand === "list") {
    const taskId = parsed.task || "";
    const result = await listSessions(context, taskId ? { taskId } : {});
    return output(parsed, result, () => {
      if (result.items.length === 0) {
        return "No AgentDesk sessions found.";
      }
      return formatTable(result.items, [
        { header: "NAME", value: (row) => row.name || row.sessionId, maxWidth: 42 },
        { header: "SESSION ID", value: (row) => row.sessionId, maxWidth: 44 },
        { header: "STATUS", value: (row) => row.status, maxWidth: 14 },
        { header: "TASK", value: (row) => row.taskName || row.taskTitle, maxWidth: 28 },
        { header: "PAR", value: (row) => row.parallelism, maxWidth: 4 },
        { header: "UPDATED", value: (row) => row.updatedAt || "-", maxWidth: 24 },
      ]);
    });
  }
  if (subcommand === "show") {
    const sessionId = required(parsed._[2], "session id");
    const result = await attachCodexAppLaunchPlan(context, await getSession(context, sessionId));
    return output(parsed, result, () => {
      return [
        `Session: ${result.name || result.sessionId}`,
        `Session ID: ${result.sessionId}`,
        `Task: ${result.task?.name || result.task?.title || result.title || result.taskId}`,
        `Task ID: ${result.taskId}`,
        `Status: ${result.status}`,
        `Parallelism: ${result.parallelism}`,
        `Succeeded: ${result.succeededAgents || 0}`,
        `Failed: ${result.failedAgents || 0}`,
        "",
        result.docContent || "(empty session documentation)",
      ].join("\n");
    });
  }
  if (subcommand === "start") {
    const taskId = required(parsed._[2], "task id");
    const result = await attachCodexAppLaunchPlan(context, await createSession(context, taskId, {
      parallelism: parsed.parallel || parsed.parallelism || parsed.concurrency || parsed["codex-count"],
      model: parsed.model,
      reasoning: parsed.reasoning || parsed.effort,
      serviceTier: parsed["service-tier"],
      executionMode: parsed["execution-mode"] || parsed.mode,
      subagentLauncher: parsed["subagent-launcher"],
      baseBranch: parsed["base-branch"] || parsed.branch,
      worktreeIntegration: parsed["worktree-integration"],
      pushWorktreeIntegration: parsed["push-worktree-integration"],
      allowDuplicateSession: parsed["allow-duplicate-session"] || parsed.force,
    }));
    return output(parsed, result, () => result.requiresHostLaunch
      ? `Prepared ${result.appLaunchPlan.subagents.length} Codex App subagent prompt(s): ${result.name || result.sessionId} (${result.sessionId})`
      : `Started session: ${result.name || result.sessionId} (${result.sessionId})`);
  }
  if (subcommand === "logs") {
    const sessionId = required(parsed._[2], "session id");
    const agentId = required(parsed._[3], "agent id");
    const result = await getAgentLogs(context, sessionId, agentId);
    return output(parsed, result, () => [
      "STDOUT",
      result.stdout || "(empty)",
      "",
      "STDERR",
      result.stderr || "(empty)",
    ].join("\n"));
  }
  throw new Error(`unknown sessions command: ${subcommand}`);
}

async function handleApi(context, parsed) {
  const { startTaskApiServer } = await import("../src/lib/task-api-server.mjs");
  const listener = await startTaskApiServer({
    context,
    host: parsed.host,
    port: parsed.port,
    sqlitePath: parsed.sqlite || parsed["sqlite-path"],
    staticDir: parsed["static-dir"],
    basePath: parsed["api-base-path"],
  });
  const payload = {
    url: listener.url,
    host: listener.host,
    port: listener.port,
    basePath: listener.basePath,
    projectRoot: context.projectRoot,
  };
  if (parsed.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`AgentDesk task API listening on ${listener.url}`);
    console.log("Use Vite dev proxy for the same base path, or pass --static-dir for built UI files.");
  }
  await waitForShutdown(listener);
}

async function waitForShutdown(listener) {
  await new Promise((resolve) => {
    const shutdown = () => {
      void listener.close().finally(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function attachCodexAppLaunchPlan(context, session) {
  if (session.subagentLauncher !== "codex-app") {
    return session;
  }
  const appLaunchPlan = await getCodexAppLaunchPlan(context, session.sessionId);
  return {
    ...session,
    requiresHostLaunch: appLaunchPlan.requiresHostLaunch,
    appLaunchPlan,
  };
}

function output(parsed, payload, renderText) {
  if (parsed.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(renderText());
}

function taskCreateAction(parsed) {
  if (parsed.rebuild) {
    return "rebuild";
  }
  if (parsed["continue-similar"]) {
    return "continue";
  }
  return "confirm";
}

function renderTaskCreateResult(result) {
  if (result.requiresConfirmation) {
    return [
      "Similar AgentDesk task(s) found. Confirm the next step before creating a new task.",
      "",
      formatTable(result.similarTasks || [], [
        { header: "NAME", value: (row) => row.name || row.title || row.taskId, maxWidth: 36 },
        { header: "TASK ID", value: (row) => row.taskId, maxWidth: 44 },
        { header: "STATUS", value: (row) => row.status, maxWidth: 14 },
        { header: "SCORE", value: (row) => row.similarityScore, maxWidth: 8 },
      ]),
      "",
      "Continue an existing task:",
      `  verunectl sessions start ${(result.similarTasks || [])[0]?.taskId || "<taskId>"}`,
      "",
      "Rebuild a fresh task from this request:",
      "  verunectl tasks create --rebuild --title <title> --brief <brief>",
    ].join("\n");
  }
  if (result.reusedExistingTask) {
    return `Continuing existing task: ${result.name || result.title || result.taskId} (${result.taskId})`;
  }
  return `Started task generation: ${result.name || result.title || result.taskId} (${result.taskId})`;
}

function renderOverallTask(task) {
  return [
    `Overall task: ${task.title}`,
    `Overall task ID: ${task.overallTaskId}`,
    `Period: ${task.periodType} ${task.periodKey}`,
    `Status: ${task.status}`,
    `Assignee: ${task.assignee || "-"}`,
    `Project root: ${task.projectRoot || "-"}`,
    `Claim: ${task.claim?.claimedBy || "-"}${task.claim?.sessionId ? ` (${task.claim.sessionId})` : ""}`,
    `Dispatch: ${task.dispatch?.status || "not_dispatched"}${task.dispatch?.sessionId ? ` (${task.dispatch.sessionId})` : ""}`,
    "",
    task.description || task.brief || "(no description)",
    "",
    "## Audit",
    "",
    ...(task.audit || []).map((entry) => `- ${entry.at} ${entry.action}${entry.actor ? ` by ${entry.actor}` : ""}${entry.sessionId ? ` (${entry.sessionId})` : ""}`),
  ].join("\n");
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      result._.push(arg);
      continue;
    }
    const keyValue = arg.slice(2);
    const equals = keyValue.indexOf("=");
    if (equals !== -1) {
      result[keyValue.slice(0, equals)] = keyValue.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      result[keyValue] = next;
      index += 1;
    } else {
      if (VALUE_OPTIONS.has(keyValue)) {
        throw new Error(`--${keyValue} requires a value`);
      }
      result[keyValue] = true;
    }
  }
  return result;
}

function wantsJsonOutput(argv) {
  return argv.includes("--json") || argv.some((arg) => arg.startsWith("--json="));
}

function required(value, label) {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

async function readStdinIfAvailable() {
  if (process.stdin.isTTY) {
    return "";
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printHelp() {
  console.log(`AgentDesk control plane

Usage:
  verunectl tasks list [--json]
  verunectl tasks show <taskId> [--json]
  verunectl tasks create [--title TEXT] [--brief TEXT] [--rebuild|--continue-similar] [--json]
  verunectl overall-tasks list [--period day|week|month] [--period-key KEY] [--status STATUS] [--assignee NAME] [--json]
  verunectl overall-tasks show <overallTaskId> [--json]
  verunectl overall-tasks create --title TEXT [--description TEXT] [--period day|week|month] [--period-key KEY] [--assignee NAME] [--json]
  verunectl overall-tasks update <overallTaskId> [--title TEXT] [--description TEXT] [--status STATUS] [--assignee NAME] [--json]
  verunectl overall-tasks claim <overallTaskId> --assignee NAME [--session SESSION] [--note TEXT] [--force] [--json]
  verunectl overall-tasks dispatch <overallTaskId> --session SESSION [--assignee NAME] [--branch BRANCH] [--force] [--json]
  verunectl api [--host HOST] [--port PORT] [--api-base-path PATH] [--static-dir DIR] [--json]
  verunectl mcp [--project DIR]
  verunectl config show [--json]
  verunectl config init [--force] [--json]
  verunectl sessions list [--task <taskId>] [--json]
  verunectl sessions show <sessionId> [--json]
  verunectl sessions start <taskId> [--model MODEL] [--reasoning EFFORT] [--parallel N] [--execution-mode MODE] [--subagent-launcher LAUNCHER] [--allow-duplicate-session] [--json]
  verunectl sessions logs <sessionId> <agentId> [--json]

Global options:
  --project DIR          Project root to inspect. Defaults to the current git root.
  --desk-root DIR        Override the AgentDesk state root. Default: <project>/.agent-desk.
  --sqlite-path FILE     Override overall task SQLite DB. Default: ~/.agent-desk/tasks.sqlite.
  --config FILE          Override the AgentDesk TOML config path. Default: <desk-root>/config.toml.
  --worktrees-root DIR   Override the persistent git worktrees root.
  --codex-cli PATH       Override the Codex CLI executable path.

Task create options:
  --rebuild              Create a fresh task even when a similar task exists.
  --continue-similar     Return the best matching existing task instead of creating a new one.

Session start options:
  --model MODEL          Codex model for subagents. Default: gpt-5.5.
  --reasoning EFFORT     Reasoning effort: low, medium, high, or xhigh. Default: xhigh.
  --service-tier TIER    Service tier. The supported value is fast.
  --parallel N           Maximum concurrent subagents or app launch prompts. Default: 6, max: 24.
  --concurrency N        Alias for --parallel.
  --codex-count N        Alias for --parallel.
  --execution-mode MODE  auto, worktree, or current-branch. Default: auto.
  --subagent-launcher L  codex-cli or codex-app for current-branch mode.
  --base-branch BRANCH   Local branch used as the base for worktree sessions. Default: current checkout branch.
  --worktree-integration MODE
                          agent-branch or fast-forward. Default: agent-branch.
  --push-worktree-integration
                          Push the configured base branch after explicit fast-forward integration.
  --allow-duplicate-session
                          Override the active-session guard for this task.
  --force                 Alias for --allow-duplicate-session.

Workflow defaults:
  Service tier: fast.
  Launch batch size: 6.
  Completed worktree sessions keep subagent branches for review unless fast-forward integration is explicitly configured.
`);
}
