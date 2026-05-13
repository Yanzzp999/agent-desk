#!/usr/bin/env node
import process from "node:process";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  collectRun,
  CONTROL_PLANE_ROOT,
  createContext,
  createPlanJob,
  formatTable,
  getCurrentRun,
  getPlanJob,
  getPlanLogs,
  getRunDetail,
  getTaskLogs,
  listPlanJobs,
  listRuns,
  retryTask,
  stopTask,
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
    stateRoot: parsed["state-dir"],
    uiStateRoot: parsed["ui-state-dir"],
  });

  if (command === "runs") {
    await handleRuns(context, parsed);
    return;
  }

  if (command === "tasks") {
    await handleTasks(context, parsed);
    return;
  }

  if (command === "planner") {
    await handlePlanner(context, parsed);
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
  for (const key of ["host", "port", "project", "state-dir", "ui-state-dir"]) {
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
    stateRoot: parsed["state-dir"],
    uiStateRoot: parsed["ui-state-dir"],
  }) : null;
  const server = createControlPlaneServer(initialContext, {
    stateRoot: parsed["state-dir"],
    uiStateRoot: parsed["ui-state-dir"],
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

async function handleRuns(context, parsed) {
  const subcommand = parsed._[1] || "list";
  if (subcommand === "list") {
    const result = await listRuns(context, { status: parsed.status || "" });
    return output(parsed, result, () => {
      if (result.items.length === 0) {
        return "No Ralph runs found.";
      }
      return formatTable(result.items, [
        { header: "RUN", value: (row) => row.runId, maxWidth: 32 },
        { header: "STATUS", value: (row) => row.status, maxWidth: 16 },
        { header: "TASKS", value: (row) => row.totalTasks, maxWidth: 7 },
        { header: "PROJECT", value: (row) => row.project || "-", maxWidth: 24 },
        { header: "UPDATED", value: (row) => row.updatedAt || "-", maxWidth: 24 },
      ]);
    });
  }
  if (subcommand === "show") {
    const runId = required(parsed._[2], "run id");
    const result = await getRunDetail(context, runId);
    return output(parsed, result, () => {
      const lines = [
        `Run: ${result.run.runId}`,
        `Project: ${result.run.project || "(unnamed)"}`,
        `Status: ${result.run.status}`,
        `Tasks: ${result.tasks.length}`,
        "",
        formatTable(result.tasks, [
          { header: "ID", value: (row) => row.id, maxWidth: 14 },
          { header: "STATUS", value: (row) => row.status, maxWidth: 14 },
          { header: "PRIO", value: (row) => row.priority ?? "-", maxWidth: 5 },
          { header: "TITLE", value: (row) => row.title || "-", maxWidth: 58 },
        ]),
      ];
      return lines.filter(Boolean).join("\n");
    });
  }
  if (subcommand === "current") {
    const result = await getCurrentRun(context);
    return output(parsed, result, () => result.runId || "No current Ralph run.");
  }
  if (subcommand === "collect") {
    const runId = required(parsed._[2], "run id");
    const result = await collectRun(context, runId);
    return output(parsed, result, () => result.stdout.trim() || "Collected run report.");
  }
  throw new Error(`unknown runs command: ${subcommand}`);
}

async function handleTasks(context, parsed) {
  const subcommand = parsed._[1];
  const runId = required(parsed._[2], "run id");
  const taskId = required(parsed._[3], "task id");
  if (subcommand === "logs") {
    const result = await getTaskLogs(context, runId, taskId, { lines: parsed.lines || 200 });
    return output(parsed, result, () => result.content || `No log file yet: ${result.path}`);
  }
  if (subcommand === "retry") {
    const result = await retryTask(context, runId, taskId, { force: Boolean(parsed.force) });
    return output(parsed, result, () => result.stdout.trim() || `Queued ${taskId} for retry.`);
  }
  if (subcommand === "stop") {
    const result = await stopTask(context, runId, taskId);
    return output(parsed, result, () => result.stdout.trim() || `Stopped ${taskId}.`);
  }
  throw new Error(`unknown tasks command: ${subcommand || ""}`);
}

async function handlePlanner(context, parsed) {
  const subcommand = parsed._[1] || "list";
  if (subcommand === "list") {
    const result = await listPlanJobs(context);
    return output(parsed, result, () => {
      if (result.items.length === 0) {
        return "No Ralph planner jobs found.";
      }
      return formatTable(result.items, [
        { header: "JOB", value: (row) => row.planJobId, maxWidth: 36 },
        { header: "STATUS", value: (row) => row.status, maxWidth: 14 },
        { header: "STAGE", value: (row) => row.stage, maxWidth: 18 },
        { header: "UPDATED", value: (row) => row.updatedAt || "-", maxWidth: 24 },
      ]);
    });
  }
  if (subcommand === "show") {
    const planJobId = required(parsed._[2], "planner job id");
    const result = await getPlanJob(context, planJobId, { includeLogs: Boolean(parsed.logs) });
    return output(parsed, result, () => {
      const contract = result.result?.contract || {};
      return [
        `Plan job: ${result.planJobId}`,
        `Status: ${result.status}`,
        `Stage: ${result.stage}`,
        `Mode: ${result.input.mode}`,
        contract.PRD_FILE ? `PRD_FILE: ${contract.PRD_FILE}` : "",
        contract.PRD_JSON ? `PRD_JSON: ${contract.PRD_JSON}` : "",
        contract.PROGRESS_FILE ? `PROGRESS_FILE: ${contract.PROGRESS_FILE}` : "",
        result.lastError ? `Last error: ${result.lastError}` : "",
      ].filter(Boolean).join("\n");
    });
  }
  if (subcommand === "logs") {
    const planJobId = required(parsed._[2], "planner job id");
    const result = await getPlanLogs(context, planJobId);
    return output(parsed, result, () => [
      "STDOUT",
      result.stdout || "(empty)",
      "",
      "STDERR",
      result.stderr || "(empty)",
    ].join("\n"));
  }
  if (subcommand === "start") {
    const inputPath = parsed.input || "";
    const featureBrief = inputPath ? "" : (parsed.brief || await readStdinIfAvailable());
    const result = await createPlanJob(context, {
      mode: inputPath ? "prd_to_json" : "brief_to_json",
      inputPath,
      featureBrief,
      outputDir: parsed["output-dir"],
      ralphDir: parsed["ralph-dir"],
      model: parsed.model,
      reasoning: parsed.reasoning,
      ...(parsed.fast ? { fast: true } : {}),
    });
    return output(parsed, result, () => `Started planner job: ${result.planJobId}`);
  }
  throw new Error(`unknown planner command: ${subcommand}`);
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
  console.log(`Ralph control plane

Usage:
  ralphctl dev [--host 127.0.0.1] [--port 4317]
  ralphctl gui [open] [--host 127.0.0.1] [--port 4317] [--project DIR] [--devtools]
  ralphctl serve [--host 127.0.0.1] [--port 4317] [--project DIR] [--open]
  ralphctl runs list [--status STATUS] [--json]
  ralphctl runs show <runId> [--json]
  ralphctl runs current [--json]
  ralphctl runs collect <runId> [--json]
  ralphctl tasks logs <runId> <taskId> [--lines N] [--json]
  ralphctl tasks retry <runId> <taskId> [--force] [--json]
  ralphctl tasks stop <runId> <taskId> [--json]
  ralphctl planner start [--brief TEXT | --input PRD.md] [--output-dir DIR] [--ralph-dir DIR] [--model MODEL] [--reasoning DEPTH] [--fast] [--json]
  ralphctl planner list [--json]
  ralphctl planner show <planJobId> [--logs] [--json]
  ralphctl planner logs <planJobId> [--json]

Global options:
  --project DIR        Project root to inspect. For gui/serve/dev, this is optional.
  --state-dir DIR      Ralph state root. Default: <project>/.ralph.
  --ui-state-dir DIR   Control-plane state root. Default: <project>/.ralph-ui.

Planner start options:
  --model MODEL        Codex-compatible model override for the planner job.
  --reasoning DEPTH    Codex-compatible reasoning depth override for the planner job.
  --fast               Request fast planner mode when supported by the planner backend.
`);
}
