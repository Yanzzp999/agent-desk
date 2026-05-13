import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const DEFAULT_LIMIT = 16;
const DEFAULT_MAX_FILES = 160;
const MAX_LINES_PER_FILE = 900;
const MAX_PARSEABLE_LINE_LENGTH = 8_000_000;
const MAX_MESSAGES_PER_SESSION = 80;
const MAX_MESSAGE_TEXT_LENGTH = 12_000;

export function defaultCodeSessionRoots(homeDir = os.homedir()) {
  return [
    {
      label: "Codex sessions",
      path: path.join(homeDir, ".codex", "sessions"),
      recursive: true,
    },
    {
      label: "Codex archived sessions",
      path: path.join(homeDir, ".codex", "archived_sessions"),
      recursive: false,
    },
  ];
}

export async function listCodeSessions(options = {}) {
  const roots = normalizeRoots(options.roots || defaultCodeSessionRoots(options.homeDir));
  const limit = clampNumber(options.limit, DEFAULT_LIMIT, 1, 60);
  const maxFiles = clampNumber(options.maxFiles, DEFAULT_MAX_FILES, 1, 500);
  const projectRoot = options.projectRoot ? path.resolve(String(options.projectRoot)) : "";
  const rootStatus = await Promise.all(roots.map(async (root) => ({
    label: root.label,
    path: root.path,
    exists: await isDirectory(root.path),
  })));

  const files = (await collectSessionFiles(roots)).slice(0, maxFiles);
  const parsed = await Promise.all(files.map((file) => parseCodeSessionFile(file).catch(() => null)));
  const recentItems = parsed
    .filter(Boolean)
    .sort(compareUpdatedDesc);
  const projectItems = projectRoot
    ? recentItems.filter((session) => session.cwd && isInsidePath(session.cwd, projectRoot))
    : [];

  return {
    projectRoot,
    items: projectItems.slice(0, limit),
    recentItems: recentItems.slice(0, limit),
    exactCount: projectItems.length,
    recentCount: recentItems.length,
    roots: rootStatus,
  };
}

function normalizeRoots(roots) {
  return roots.map((root) => {
    if (typeof root === "string") {
      return {
        label: path.basename(root) || root,
        path: path.resolve(root),
        recursive: true,
      };
    }
    return {
      label: root.label || path.basename(root.path) || root.path,
      path: path.resolve(root.path),
      recursive: root.recursive !== false,
    };
  });
}

async function collectSessionFiles(roots) {
  const files = [];
  for (const root of roots) {
    const rootStat = await fs.promises.stat(root.path).catch(() => null);
    if (!rootStat?.isDirectory()) {
      continue;
    }
    const found = root.recursive
      ? await walkJsonlFiles(root.path)
      : await listJsonlFiles(root.path);
    for (const filePath of found) {
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (stat?.isFile()) {
        files.push({
          filePath,
          source: root.label,
          sourceRoot: root.path,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          mtime: stat.mtime,
        });
      }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function walkJsonlFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

async function listJsonlFiles(root) {
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(root, entry.name));
}

async function parseCodeSessionFile(file) {
  const session = {
    id: `code-${hashValue(file.filePath).slice(0, 12)}`,
    source: file.source,
    sourcePath: file.filePath,
    sourceRoot: file.sourceRoot,
    relativePath: path.relative(file.sourceRoot, file.filePath),
    size: file.size,
    conversationId: "",
    cwd: "",
    title: "",
    model: "",
    effort: "",
    originator: "",
    createdAt: "",
    updatedAt: file.mtime.toISOString(),
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    toolCallCount: 0,
    contextWindow: 0,
    tokenUsage: emptyTokenUsage(),
    rateLimits: emptyRateLimits(),
    prompts: [],
    messages: [],
  };

  const stream = fs.createReadStream(file.filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineCount = 0;

  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      lineCount += 1;
      if (lineCount > MAX_LINES_PER_FILE) {
        break;
      }
      if (line.length > MAX_PARSEABLE_LINE_LENGTH) {
        readRawLargeLine(session, line);
        continue;
      }
      const event = JSON.parse(line);
      readCodeSessionEvent(session, event);
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  session.title = pickSessionTitle(session.prompts, file.filePath);
  session.prompts = session.prompts
    .map(cleanPromptText)
    .filter(Boolean)
    .filter((prompt) => !isInstructionPrompt(prompt))
    .slice(0, 5);
  session.messages = session.messages
    .filter((message) => message.text && !isInstructionPrompt(message.text))
    .slice(-MAX_MESSAGES_PER_SESSION);

  return session;
}

export async function continueCodeSession(options = {}) {
  const prompt = String(options.prompt || "").trim();
  if (!prompt) {
    throw new Error("prompt is required");
  }
  const session = options.session || {};
  const sessionId = String(options.sessionId || session.conversationId || "").trim();
  if (!sessionId) {
    throw new Error("session id is required");
  }

  const codexCliPath = options.codexCliPath || "codex";
  const cwd = session.cwd || options.cwd || process.cwd();
  const args = ["exec", "resume", "--all", sessionId, "-"];
  const runCommand = options.runCommand || spawnCapture;
  const result = await runCommand(codexCliPath, args, { cwd, stdin: prompt });
  if (result.exitCode !== 0) {
    const details = cleanPromptText(result.stderr || result.stdout || "Codex resume failed");
    throw new Error(details || "Codex resume failed");
  }

  return {
    sessionId,
    exitCode: result.exitCode,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    updatedAt: new Date().toISOString(),
  };
}

function readCodeSessionEvent(session, event) {
  const payload = event?.payload || {};
  if (event.timestamp) {
    session.updatedAt = maxIsoDate(session.updatedAt, event.timestamp);
  }

  if (event.type === "session_meta") {
    session.conversationId = payload.id || session.conversationId;
    session.cwd = payload.cwd || session.cwd;
    session.createdAt = payload.timestamp || event.timestamp || session.createdAt;
    session.originator = payload.originator || session.originator;
    return;
  }

  if (event.type === "event_msg" && payload.type === "task_started") {
    session.contextWindow = clampNumber(payload.model_context_window, session.contextWindow || 0, 0, Number.MAX_SAFE_INTEGER);
    return;
  }

  if (event.type === "event_msg" && payload.type === "token_count") {
    const info = payload.info || {};
    session.contextWindow = clampNumber(info.model_context_window, session.contextWindow || 0, 0, Number.MAX_SAFE_INTEGER);
    session.tokenUsage = {
      total: normalizeTokenCounter(info.total_token_usage),
      last: normalizeTokenCounter(info.last_token_usage),
      updatedAt: event.timestamp || session.updatedAt,
    };
    session.rateLimits = normalizeRateLimits(payload.rate_limits);
    return;
  }

  if (event.type === "turn_context") {
    session.cwd = payload.cwd || session.cwd;
    session.model = payload.model || session.model;
    session.effort = payload.effort || session.effort;
    return;
  }

  const role = payload.role || payload.item?.role || payload.message?.role || "";
  if (role === "user") {
    const text = cleanMessageText(extractReadableText(payload.content || payload.item?.content || payload.message?.content));
    if (text && !isInstructionPrompt(text)) {
      session.prompts.push(text);
      session.messages.push({
        role: "user",
        text,
        timestamp: event.timestamp || session.updatedAt,
      });
    }
    session.messageCount += 1;
    session.userMessageCount += 1;
    return;
  }

  if (role === "assistant") {
    const text = cleanMessageText(extractReadableText(payload.content || payload.item?.content || payload.message?.content));
    if (text) {
      session.messages.push({
        role: "assistant",
        text,
        timestamp: event.timestamp || session.updatedAt,
      });
    }
    session.messageCount += 1;
    session.assistantMessageCount += 1;
    return;
  }

  if (payload.type === "function_call" || (payload.name && payload.arguments)) {
    session.toolCallCount += 1;
  }
}

function readRawLargeLine(session, line) {
  if (!line.includes("\"role\":\"user\"")) {
    return;
  }
  const match = line.match(/"text":"((?:\\.|[^"\\]){1,2000})"/);
  if (!match) {
    return;
  }
  try {
    session.prompts.push(JSON.parse(`"${match[1]}"`));
    session.messageCount += 1;
    session.userMessageCount += 1;
  } catch {
    // Ignore malformed partial strings from very large JSONL records.
  }
}

function extractReadableText(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractReadableText).filter(Boolean).join("\n");
  }
  if (typeof value !== "object") {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.content === "string") {
    return value.content;
  }
  return extractReadableText(value.content || value.message || value.summary || "");
}

function pickSessionTitle(prompts, filePath) {
  for (const prompt of prompts) {
    const clean = cleanPromptText(prompt);
    if (!clean || isInstructionPrompt(clean)) {
      continue;
    }
    return excerpt(clean, 84);
  }
  return filenameTitle(filePath);
}

function cleanPromptText(value) {
  return String(value || "")
    .replace(/<image>[\s\S]*?<\/image>/gi, " ")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMessageText(value) {
  const text = String(value || "")
    .replace(/<image>[\s\S]*?<\/image>/gi, " ")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > MAX_MESSAGE_TEXT_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_TEXT_LENGTH - 1).trimEnd()}…`
    : text;
}

function isInstructionPrompt(value) {
  return /^# AGENTS\.md instructions\b/i.test(value)
    || /^<INSTRUCTIONS>/i.test(value)
    || /^Knowledge cutoff:/i.test(value);
}

function filenameTitle(filePath) {
  const base = path.basename(filePath, ".jsonl");
  return base
    .replace(/^rollout-/, "")
    .replace(/-\d{4}[a-z0-9-]{12,}$/i, "")
    .replace(/[T-]/g, " ")
    .trim() || base;
}

function maxIsoDate(current, candidate) {
  const currentTime = Date.parse(current || "");
  const candidateTime = Date.parse(candidate || "");
  if (Number.isNaN(candidateTime)) {
    return current;
  }
  if (Number.isNaN(currentTime) || candidateTime > currentTime) {
    return new Date(candidateTime).toISOString();
  }
  return current;
}

function compareUpdatedDesc(a, b) {
  return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
}

function isInsidePath(candidate, root) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function hashValue(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function emptyTokenUsage() {
  return {
    total: normalizeTokenCounter(),
    last: normalizeTokenCounter(),
    updatedAt: "",
  };
}

function normalizeTokenCounter(value = {}) {
  return {
    inputTokens: clampNumber(value.input_tokens, 0, 0, Number.MAX_SAFE_INTEGER),
    cachedInputTokens: clampNumber(value.cached_input_tokens, 0, 0, Number.MAX_SAFE_INTEGER),
    outputTokens: clampNumber(value.output_tokens, 0, 0, Number.MAX_SAFE_INTEGER),
    reasoningOutputTokens: clampNumber(value.reasoning_output_tokens, 0, 0, Number.MAX_SAFE_INTEGER),
    totalTokens: clampNumber(value.total_tokens, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function emptyRateLimits() {
  return {
    planType: "",
    primaryUsedPercent: 0,
    primaryWindowMinutes: 0,
    secondaryUsedPercent: 0,
    secondaryWindowMinutes: 0,
  };
}

function normalizeRateLimits(value = {}) {
  return {
    planType: typeof value.plan_type === "string" ? value.plan_type : "",
    primaryUsedPercent: clampNumber(value.primary?.used_percent, 0, 0, 100),
    primaryWindowMinutes: clampNumber(value.primary?.window_minutes, 0, 0, Number.MAX_SAFE_INTEGER),
    secondaryUsedPercent: clampNumber(value.secondary?.used_percent, 0, 0, 100),
    secondaryWindowMinutes: clampNumber(value.secondary?.window_minutes, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function excerpt(value, max) {
  const text = String(value || "").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

async function isDirectory(dirPath) {
  const stat = await fs.promises.stat(dirPath).catch(() => null);
  return Boolean(stat?.isDirectory());
}

async function spawnCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ exitCode: 1, signal: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode: exitCode ?? 1, signal, stdout, stderr });
    });
    child.stdin.end(options.stdin || "");
  });
}
