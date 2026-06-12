import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_DISCOVERY_TIMEOUT_MS = 3000;
const DEFAULT_CLAUDE_COMMAND = "claude";
const ENV_CLAUDE_CODE_CLI_KEYS = Object.freeze(["CLAUDE_CODE_CLI", "CLAUDE_CLI", "CLAUDE_CLI_PATH"]);

export const CLAUDE_CODE_FALLBACK_MODELS = Object.freeze([
  freezeModel({
    slug: "haiku",
    displayName: "Haiku",
    description: "Fastest Claude model for lightweight subagent work.",
    priority: 0,
    visibility: "list",
  }),
  freezeModel({
    slug: "sonnet",
    displayName: "Sonnet",
    description: "Balanced Claude model for everyday coding tasks.",
    priority: 10,
    visibility: "list",
  }),
  freezeModel({
    slug: "opus",
    displayName: "Opus",
    description: "Most capable Claude model for complex work.",
    priority: 20,
    visibility: "fallback",
  }),
]);

export function resolveClaudeCodeCliPath(options = {}) {
  const env = options.env || process.env;
  const explicitPath = firstNonEmpty([options.explicitPath, options.claudeCodeCliPath]);
  if (explicitPath) {
    return resolveCliValue(explicitPath, options.pathValue ?? env.PATH);
  }

  const envPath = firstNonEmpty(ENV_CLAUDE_CODE_CLI_KEYS.map((key) => env[key]));
  if (envPath) {
    return resolveCliValue(envPath, options.pathValue ?? env.PATH);
  }

  const pathValue = options.pathValue ?? env.PATH;
  const pathMatch = findExecutableOnPath(DEFAULT_CLAUDE_COMMAND, pathValue);
  return pathMatch || DEFAULT_CLAUDE_COMMAND;
}

export const resolveClaudeCodeCli = resolveClaudeCodeCliPath;

export function buildClaudeCodePrintArgs(options = {}) {
  const args = [
    "-p",
    String(options.prompt || ""),
    "--model",
    options.model || CLAUDE_CODE_FALLBACK_MODELS[0].slug,
    "--dangerously-skip-permissions",
    "--output-format",
    "json",
  ];
  if (options.cwd) {
    args.push("--add-dir", options.cwd);
  }
  return args;
}

export async function discoverClaudeCodeModels(options = {}) {
  const claudeCliPath = resolveClaudeCodeCliPath(options);
  const errors = [];
  let version = "";
  try {
    const result = await spawnCapture(claudeCliPath, ["--version"], {
      timeoutMs: options.timeoutMs || DEFAULT_DISCOVERY_TIMEOUT_MS,
    });
    version = firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr);
    if (result.exitCode !== 0) {
      errors.push(result.stderr || `claude --version exited with code ${result.exitCode}`);
    }
  } catch (error) {
    errors.push(error.message || String(error));
  }

  const available = errors.length === 0 || Boolean(version);
  return Object.freeze({
    models: CLAUDE_CODE_FALLBACK_MODELS,
    source: available ? "claude-code-cli" : "fallback",
    claudeCodeCliPath: claudeCliPath,
    command: claudeCliPath,
    version,
    errors: Object.freeze(errors),
  });
}

export function parseClaudePrintOutput(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      const sessionId = String(parsed.session_id || "").trim();
      if (!sessionId) {
        continue;
      }
      return Object.freeze({
        claudeSessionId: sessionId,
        claudeResumeCommand: `claude --resume ${sessionId}`,
      });
    } catch {
      // Keep scanning older lines for a valid JSON payload.
    }
  }
  return Object.freeze({
    claudeSessionId: "",
    claudeResumeCommand: "",
  });
}

async function spawnCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ exitCode: 1, signal: "SIGTERM", stdout, stderr: `${stderr}timed out` });
    }, options.timeoutMs || DEFAULT_DISCOVERY_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ exitCode: 1, signal: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      finish({ exitCode: exitCode ?? 1, signal, stdout, stderr });
    });
  });
}

function findExecutableOnPath(command, pathValue) {
  const entries = String(pathValue || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const entry of entries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${command}${extension}`);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return "";
}

function resolveCliValue(value, pathValue) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (path.isAbsolute(text) || /[\\/]/.test(text)) {
    return path.resolve(text);
  }
  return findExecutableOnPath(text, pathValue) || text;
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function firstNonEmpty(values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function firstNonEmptyLine(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function freezeModel(model) {
  return Object.freeze({ ...model });
}

export default Object.freeze({
  CLAUDE_CODE_FALLBACK_MODELS,
  buildClaudeCodePrintArgs,
  discoverClaudeCodeModels,
  parseClaudePrintOutput,
  resolveClaudeCodeCli,
  resolveClaudeCodeCliPath,
});