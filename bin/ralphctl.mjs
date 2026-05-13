#!/usr/bin/env node
import process from "node:process";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  CONTROL_PLANE_ROOT,
  createContext,
  createSession,
  createTask,
  formatTable,
  getAgentLogs,
  getSession,
  getTask,
  listSessions,
  listTasks,
} from "../src/lib/control-plane.mjs";
import { createControlPlaneServer } from "../src/server/server.mjs";

main().catch((error) => {
  console.error(`ralphctl: ${error.message}`);
  process.exit(1);
});

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed._[0] || "help";

  if (parsed.help || command === "help") {
    printHelp();
    return;
  }

  if (command === "dev" || command === "gui") {
    const subcommand = parsed._[1] || "";
    if (command === "gui" && subcommand && subcommand !== "open") {
      throw new Error(`unknown gui command: ${subcommand}`);
    }
    await launchDesktopGui(parsed);
    return;
  }

  if (command === "serve") {
    await serveWeb(parsed, { open: Boolean(parsed.open) });
    return;
  }

  const context = createContext({
    projectRoot: parsed.project,
    deskRoot: parsed["desk-root"],
    worktreesRoot: parsed["worktrees-root"],
  });

  if (command === "tasks") {
    await handleTasks(context, parsed);
    return;
  }

  if (command === "sessions") {
    await handleSessions(context, parsed);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

async function launchDesktopGui(parsed) {
  const electronPath = path.join(
    CONTROL_PLANE_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron.cmd" : "electron",
  );
  const child = spawn(electronPath, buildDesktopArgs(parsed), {
    cwd: CONTROL_PLANE_ROOT,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve) => {
    child.on("error", (error) => {
      console.error(`ralphctl: failed to launch AgentDesk desktop app: ${error.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 0));
  });
  process.exit(exitCode);
}

function buildDesktopArgs(parsed) {
  const args = [path.join(CONTROL_PLANE_ROOT, "src", "desktop", "main.mjs")];
  for (const key of ["host", "port", "project", "desk-root", "worktrees-root"]) {
    if (parsed[key]) {
      args.push(`--${key}`, String(parsed[key]));
    }
  }
  if (parsed.devtools) {
    args.push("--devtools");
  }
  return args;
}

async function serveWeb(parsed, options = {}) {
  const host = parsed.host || "127.0.0.1";
  const port = Number(parsed.port || 4317);
  const initialContext = parsed.project ? createContext({
    projectRoot: parsed.project,
    deskRoot: parsed["desk-root"],
    worktreesRoot: parsed["worktrees-root"],
  }) : null;
  const server = createControlPlaneServer(initialContext, {
    deskRoot: parsed["desk-root"],
    worktreesRoot: parsed["worktrees-root"],
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const url = `http://${host}:${port}`;
  if (options.open) {
    openBrowser(url);
  }
  console.log(`AgentDesk web server: ${url}`);
  console.log(initialContext ? `Project: ${initialContext.projectRoot}` : "Project: choose in the web UI");
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
      ].join("\n");
    });
  }
  if (subcommand === "create") {
    const title = parsed.title || "";
    const brief = parsed.brief || await readStdinIfAvailable();
    const result = await createTask(context, { title, brief });
    return output(parsed, result, () => `Started task generation: ${result.taskId}`);
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
      parallelism: parsed.parallel || parsed.parallelism,
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
    if (next && !next.startsWith("--")) {
      result[keyValue] = next;
      index += 1;
    } else {
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

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function printHelp() {
  console.log(`AgentDesk control plane

Usage:
  ralphctl dev [--host 127.0.0.1] [--port 4317]
  ralphctl gui [open] [--host 127.0.0.1] [--port 4317] [--project DIR] [--devtools]
  ralphctl serve [--host 127.0.0.1] [--port 4317] [--project DIR] [--open]
  ralphctl tasks list [--json]
  ralphctl tasks show <taskId> [--json]
  ralphctl tasks create [--title TEXT] [--brief TEXT] [--json]
  ralphctl sessions list [--task <taskId>] [--json]
  ralphctl sessions show <sessionId> [--json]
  ralphctl sessions start <taskId> [--parallel N] [--json]
  ralphctl sessions logs <sessionId> <agentId> [--json]

Global options:
  --project DIR          Project root to inspect. For gui/serve/dev, this is optional.
  --desk-root DIR        Override the AgentDesk state root. Default: <project>/.agent-desk.
  --worktrees-root DIR   Override the persistent git worktrees root.
`);
}
