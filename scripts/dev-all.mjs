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

const children = [];
let shuttingDown = false;
let requestedExitCode = 0;

console.log("Starting AgentDesk local development servers...");
console.log(`API: http://${apiHost}:${apiPort}${apiBasePath}`);
console.log("Web: Vite dev server, usually http://127.0.0.1:5173");
console.log("Press Ctrl+C to stop both processes.");

startChild("api", process.execPath, [
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
  npm run dev:all -- [verunectl api options]

Examples:
  npm run dev:all -- --project /absolute/path/to/project
  npm run dev:all -- --project . --sqlite-path /tmp/agent-desk.sqlite

This starts:
  API: ./bin/verunectl.mjs api ...
  Web: npm run dev
`);
}
