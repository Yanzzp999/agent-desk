#!/usr/bin/env node
import process from "node:process";
import { startAgentDeskMcpServer } from "../src/lib/mcp-server.mjs";
import {
  createContext,
  createSession,
  createTask,
  formatTable,
  getAgentLogs,
  readAgentDeskConfig,
  getSession,
  getTask,
  listSessions,
  listTasks,
  writeDefaultAgentDeskConfig,
} from "../src/lib/control-plane.mjs";

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
  "subagent-launcher",
  "task",
  "title",
  "brief",
  "worktrees-root",
]);

main().catch((error) => {
  console.error(`verunectl: ${error.message}`);
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
    await startAgentDeskMcpServer({ projectRoot: parsed.project });
    return;
  }

  const context = createContext({
    projectRoot: parsed.project,
    deskRoot: parsed["desk-root"],
    worktreesRoot: parsed["worktrees-root"],
    configPath: parsed.config,
    codexCli: parsed["codex-cli"],
  });

  if (command === "tasks") {
    await handleTasks(context, parsed);
    return;
  }

  if (command === "sessions") {
    await handleSessions(context, parsed);
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
        { header: "TASK", value: (row) => row.taskId, maxWidth: 44 },
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
        `Task: ${result.title || result.taskId}`,
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
        { header: "SESSION", value: (row) => row.sessionId, maxWidth: 44 },
        { header: "STATUS", value: (row) => row.status, maxWidth: 14 },
        { header: "TASK", value: (row) => row.taskTitle, maxWidth: 28 },
        { header: "PAR", value: (row) => row.parallelism, maxWidth: 4 },
        { header: "UPDATED", value: (row) => row.updatedAt || "-", maxWidth: 24 },
      ]);
    });
  }
  if (subcommand === "show") {
    const sessionId = required(parsed._[2], "session id");
    const result = await getSession(context, sessionId);
    return output(parsed, result, () => {
      return [
        `Session: ${result.sessionId}`,
        `Task: ${result.task?.title || result.title || result.taskId}`,
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
    const result = await createSession(context, taskId, {
      parallelism: parsed.parallel || parsed.parallelism || parsed.concurrency || parsed["codex-count"],
      model: parsed.model,
      reasoning: parsed.reasoning || parsed.effort,
      executionMode: parsed["execution-mode"] || parsed.mode,
      subagentLauncher: parsed["subagent-launcher"],
      allowDuplicateSession: parsed["allow-duplicate-session"] || parsed.force,
    });
    return output(parsed, result, () => `Started session: ${result.sessionId}`);
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
        { header: "TASK", value: (row) => row.taskId, maxWidth: 44 },
        { header: "STATUS", value: (row) => row.status, maxWidth: 14 },
        { header: "SCORE", value: (row) => row.similarityScore, maxWidth: 8 },
        { header: "TITLE", value: (row) => row.title, maxWidth: 42 },
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
    return `Continuing existing task: ${result.taskId}`;
  }
  return `Started task generation: ${result.taskId}`;
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
  --config FILE          Override the AgentDesk TOML config path. Default: <desk-root>/config.toml.
  --worktrees-root DIR   Override the persistent git worktrees root.
  --codex-cli PATH       Override the Codex CLI executable path.

Task create options:
  --rebuild              Create a fresh task even when a similar task exists.
  --continue-similar     Return the best matching existing task instead of creating a new one.

Session start options:
  --model MODEL          Codex model for subagents. Default: gpt-5.5.
  --reasoning EFFORT     Reasoning effort: low, medium, high, or xhigh. Default: xhigh.
  --parallel N           Maximum concurrent subagents or app launch prompts. Default: 6, max: 24.
  --concurrency N        Alias for --parallel.
  --codex-count N        Alias for --parallel.
  --execution-mode MODE  auto, worktree, or current-branch. Default: auto.
  --subagent-launcher L  codex-cli or codex-app for current-branch mode.
  --allow-duplicate-session
                          Override the active-session guard for this task.
  --force                 Alias for --allow-duplicate-session.
`);
}
