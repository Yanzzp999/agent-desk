#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = "19731";
const DEFAULT_API_BASE_PATH = "/api/agentdesk";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  printHelp();
  process.exit(0);
}

const apiHost = getOptionValue(args, "host") || process.env.AGENT_DESK_TASK_API_HOST || DEFAULT_API_HOST;
const apiPort = getOptionValue(args, "port") || process.env.AGENT_DESK_TASK_API_PORT || DEFAULT_API_PORT;
const apiBasePath = getOptionValue(args, "api-base-path")
  || process.env.AGENT_DESK_TASK_API_BASE_PATH
  || DEFAULT_API_BASE_PATH;
const apiArgs = hasOption(args, "api-base-path") || !process.env.AGENT_DESK_TASK_API_BASE_PATH
  ? args
  : [...args, "--api-base-path", apiBasePath];
const childEnv = {
  ...process.env,
  AGENT_DESK_TASK_API_HOST: apiHost,
  AGENT_DESK_TASK_API_PORT: apiPort,
  AGENT_DESK_TASK_API_BASE_PATH: apiBasePath,
};

// Determine whether to use Node's built-in file watcher for the API process.
// This must be declared early because it's used in the startup logs below.
const useApiWatch = !process.env.AGENT_DESK_NO_WATCH;

// Strengthen Node's built-in watcher with explicit paths for reliability.
// This makes the API restart much more consistently when you edit backend code.
const apiNodeArgs = useApiWatch
  ? [
      "--watch",
      "--watch-preserve-output",
      "--watch-path=src",
      "--watch-path=bin",
      "--watch-path=package.json",
      // Note: no root tsconfig.json exists (only tsconfig.web.json for the Vite web app).
      // The API backend uses plain .mjs files; watching tsconfig.web.json is not needed here.
    ]
  : [];

const children = [];
let shuttingDown = false;
let requestedExitCode = 0;

console.log("Starting AgentDesk local development servers...");
console.log(`API: http://${apiHost}:${apiPort}${apiBasePath}`);
console.log("Web: Vite dev server, usually http://127.0.0.1:5173");

console.log("");
console.log("Behavior:");
console.log("  - Backend changes → API process restarts automatically (Node --watch)");
console.log("  - Most frontend changes → Instant HMR updates (no server restart needed)");
console.log("  - For vite.config.ts, dependency, or major config changes → You may need to restart this command");
console.log("");
if (useApiWatch) {
  console.log("API: auto-restarts on code changes (Node --watch with explicit paths).");
  console.log("     Set AGENT_DESK_NO_WATCH=1 to disable auto-restart.");
} else {
  console.log("API: running without auto-restart (AGENT_DESK_NO_WATCH set).");
}
console.log("Frontend: Vite dev server with Hot Module Replacement (HMR).");
console.log("          Most frontend changes update instantly without full restart.");
console.log("          Full Vite restart is only needed for vite.config.ts, new dependencies, etc.");
console.log("Press Ctrl+C to stop both processes.");

startChild("api", process.execPath, [
  ...apiNodeArgs,
  path.join(REPO_ROOT, "bin/verunectl.mjs"),
  "api",
  ...apiArgs,
]);
startChild("web", npmCommand(), ["run", "dev"]);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdown(signal, 0);
  });
}

process.once("SIGHUP", () => {
  shutdown("SIGHUP", 0);
});

function startChild(name, command, childArgs) {
  const child = spawn(command, childArgs, {
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.push({ child, name });
  prefixStream(name, child.stdout, process.stdout);
  prefixStream(name, child.stderr, process.stderr);

  child.once("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    shutdown(undefined, 1);
  });

  child.once("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const detail = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[${name}] exited with ${detail}; stopping remaining processes.`);
    shutdown(undefined, typeof code === "number" ? code : 1);
  });
}

function shutdown(signal, exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  requestedExitCode = exitCode;

  for (const { child } of children) {
    if (!child.killed && child.exitCode === null) {
      child.kill(signal || "SIGTERM");
    }
  }

  const forceKillTimer = setTimeout(() => {
    for (const { child } of children) {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 5000);
  forceKillTimer.unref();

  Promise.all(children.map(({ child }) => waitForExit(child))).then(() => {
    clearTimeout(forceKillTimer);
    process.exit(requestedExitCode);
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", resolve);
  });
}

function prefixStream(name, input, output) {
  let pending = "";
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      output.write(`[${name}] ${line}\n`);
    }
  });
  input.on("end", () => {
    if (pending) {
      output.write(`[${name}] ${pending}\n`);
    }
  });
}

function getOptionValue(argv, name) {
  const prefix = `--${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === `--${name}`) {
      return argv[index + 1];
    }
  }
  return "";
}

function hasOption(argv, name) {
  const prefix = `--${name}=`;
  return argv.some((arg) => arg === `--${name}` || arg.startsWith(prefix));
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function printHelp() {
  console.log(`AgentDesk local dev helper

Usage:
  npm run dev:all                       # runs at the user root; opens the user-level task view

The app stores all tasks in the user-level store (~/.agent-desk/tasks.sqlite) and opens on the
user-level task view by default. You do NOT need to pass --project; pick a project from the
sidebar (or create/import one) when you want to drill into project work.

Examples:
  npm run dev:all                                  # default: user root
  npm run dev:all -- --port 19800                  # custom API port
  npm run dev:all -- --sqlite-path /tmp/ad.sqlite  # custom task store (testing)

Behavior:
  - Backend (API): Auto-restarts on code changes using Node --watch.
  - Frontend: Uses Vite with Hot Module Replacement (HMR).
    → Most .tsx / .css changes update instantly without restarting the dev server.
    → You only need to restart "dev:all" for vite.config.ts, new dependencies, or major config changes.

Tip:
  - Disable API auto-restart: AGENT_DESK_NO_WATCH=1 npm run dev:all
`);
}
