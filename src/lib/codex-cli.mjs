import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_DISCOVERY_TIMEOUT_MS = 3000;
const DEFAULT_CODEX_COMMAND = "codex";
const ENV_CODEX_CLI_KEYS = Object.freeze(["CODEX_CLI", "CODEX_CLI_PATH"]);
const MODEL_DISCOVERY_COMMANDS = Object.freeze([
  Object.freeze(["debug", "models"]),
  Object.freeze(["models", "--json"]),
  Object.freeze(["models"]),
]);
const FAST_TIER = "fast";
const REASONING_LABELS = Object.freeze({
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
});
const REASONING_DESCRIPTIONS = Object.freeze({
  low: "Fast responses with lighter reasoning.",
  medium: "Balances speed and reasoning depth for everyday tasks.",
  high: "Greater reasoning depth for complex problems.",
  xhigh: "Extra high reasoning depth for complex problems.",
});

export const CODEX_REASONING_EFFORT_OPTIONS = Object.freeze([
  freezeReasoningOption({
    value: "",
    label: "Default",
    description: "Use the Codex CLI default for the selected model.",
  }),
  freezeReasoningOption({ value: "low", label: REASONING_LABELS.low, description: REASONING_DESCRIPTIONS.low }),
  freezeReasoningOption({
    value: "medium",
    label: REASONING_LABELS.medium,
    description: REASONING_DESCRIPTIONS.medium,
  }),
  freezeReasoningOption({ value: "high", label: REASONING_LABELS.high, description: REASONING_DESCRIPTIONS.high }),
  freezeReasoningOption({
    value: "xhigh",
    label: REASONING_LABELS.xhigh,
    description: REASONING_DESCRIPTIONS.xhigh,
  }),
]);

export const CODEX_FAST_SUPPORT_METADATA = Object.freeze({
  tier: FAST_TIER,
  modelFields: Object.freeze(["additional_speed_tiers", "service_tiers", "speed_tiers"]),
  description: "Codex CLI model catalogs mark fast-capable models with a fast speed or service tier.",
});

export const CODEX_FALLBACK_MODELS = Object.freeze([
  freezeModel({
    slug: "gpt-5.5",
    displayName: "GPT-5.5",
    description: "Frontier model for complex coding, research, and real-world work.",
    defaultReasoningEffort: "xhigh",
    reasoningEfforts: reasoningEfforts(["low", "medium", "high", "xhigh"]),
    fast: freezeFastSupport({ supported: true, source: "fallback" }),
    visibility: "list",
    priority: 0,
  }),
  freezeModel({
    slug: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    description: "Codex-optimized model for agentic coding work.",
    defaultReasoningEffort: "medium",
    reasoningEfforts: reasoningEfforts(["low", "medium", "high"]),
    fast: freezeFastSupport({ supported: true, source: "fallback" }),
    visibility: "list",
    priority: 10,
  }),
  freezeModel({
    slug: "gpt-5",
    displayName: "GPT-5",
    description: "General-purpose reasoning model.",
    defaultReasoningEffort: "medium",
    reasoningEfforts: reasoningEfforts(["low", "medium", "high"]),
    fast: freezeFastSupport({ supported: false, source: "fallback" }),
    visibility: "fallback",
    priority: 20,
  }),
  freezeModel({
    slug: "o4-mini",
    displayName: "o4-mini",
    description: "Smaller reasoning model for lighter work.",
    defaultReasoningEffort: "medium",
    reasoningEfforts: reasoningEfforts(["low", "medium", "high"]),
    fast: freezeFastSupport({ supported: false, source: "fallback" }),
    visibility: "fallback",
    priority: 30,
  }),
]);

export function resolveCodexCliPath(options = {}) {
  const env = options.env || process.env;
  const explicitPath = firstNonEmpty([options.explicitPath, options.codexCliPath]);
  if (explicitPath) {
    return resolveCliValue(explicitPath, options.pathValue ?? env.PATH);
  }

  const envPath = firstNonEmpty(ENV_CODEX_CLI_KEYS.map((key) => env[key]));
  if (envPath) {
    return resolveCliValue(envPath, options.pathValue ?? env.PATH);
  }

  const pathValue = options.pathValue ?? env.PATH;
  const pathMatch = findExecutableOnPath(DEFAULT_CODEX_COMMAND, pathValue);
  return pathMatch || DEFAULT_CODEX_COMMAND;
}

export const resolveCodexCli = resolveCodexCliPath;

export function getCodexReasoningEffortOptions(model = null) {
  const modelEfforts = Array.isArray(model?.reasoningEfforts)
    ? model.reasoningEfforts
    : normalizeCodexModel(model)?.reasoningEfforts;
  const supported = Array.isArray(modelEfforts) && modelEfforts.length > 0
    ? new Set(modelEfforts.map((entry) => entry.value || entry.effort || entry))
    : null;
  if (!supported) {
    return CODEX_REASONING_EFFORT_OPTIONS;
  }
  return Object.freeze(CODEX_REASONING_EFFORT_OPTIONS.filter((option) => !option.value || supported.has(option.value)));
}

export function getCodexFastSupportMetadata(models = CODEX_FALLBACK_MODELS) {
  const normalizedModels = normalizeModelList(models);
  const supportedModels = normalizedModels.filter((model) => model.fast.supported).map((model) => model.slug);
  return Object.freeze({
    ...CODEX_FAST_SUPPORT_METADATA,
    supported: supportedModels.length > 0,
    supportedModels: Object.freeze(supportedModels),
  });
}

export function parseCodexModelsOutput(output) {
  const text = String(output || "").trim();
  if (!text) {
    return [];
  }

  const jsonModels = parseJsonModels(text);
  if (jsonModels.length > 0) {
    return normalizeModelList(jsonModels);
  }

  return normalizeModelList(parseTextModels(text));
}

export async function discoverCodexModels(options = {}) {
  const codexCliPath = resolveCodexCliPath(options);
  const commands = options.commands || MODEL_DISCOVERY_COMMANDS;
  const runCommand = options.runCommand || spawnCapture;
  const errors = [];

  for (const commandArgs of commands) {
    const args = Array.isArray(commandArgs) ? commandArgs : String(commandArgs || "").trim().split(/\s+/).filter(Boolean);
    const result = await runCommand(codexCliPath, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      timeoutMs: options.timeoutMs || DEFAULT_DISCOVERY_TIMEOUT_MS,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const models = parseCodexModelsOutput(output);
    if (result.exitCode === 0 && models.length > 0) {
      return withDiscoveryMetadata(models, {
        source: "codex-cli",
        codexCliPath,
        command: [codexCliPath, ...args].join(" "),
        errors,
      });
    }
    errors.push({
      command: [codexCliPath, ...args].join(" "),
      exitCode: result.exitCode,
      stderr: String(result.stderr || "").trim(),
    });
  }

  return withDiscoveryMetadata(CODEX_FALLBACK_MODELS, {
    source: "fallback",
    codexCliPath,
    command: "",
    errors,
  });
}

export function normalizeCodexModel(raw, index = 0) {
  if (typeof raw === "string") {
    return freezeModel({
      slug: raw,
      displayName: raw,
      description: "",
      defaultReasoningEffort: "",
      reasoningEfforts: [],
      fast: freezeFastSupport({ supported: false, source: "" }),
      visibility: "",
      priority: index,
    });
  }

  const slug = String(raw?.slug || raw?.id || raw?.model || raw?.name || "").trim();
  if (!slug) {
    return null;
  }

  const reasoningEffortEntries = normalizeReasoningEfforts(
    raw.supported_reasoning_levels
      || raw.supportedReasoningLevels
      || raw.reasoning_efforts
      || raw.reasoningEfforts
      || raw.reasoning,
  );
  const defaultReasoningEffort = String(
    raw.default_reasoning_level
      || raw.defaultReasoningLevel
      || raw.default_reasoning_effort
      || raw.defaultReasoningEffort
      || "",
  ).trim();
  const fast = extractFastSupport(raw);
  return freezeModel({
    slug,
    displayName: String(raw.display_name || raw.displayName || raw.label || slug).trim(),
    description: String(raw.description || "").trim(),
    defaultReasoningEffort,
    reasoningEfforts: reasoningEffortEntries,
    fast,
    visibility: String(raw.visibility || "").trim(),
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : index,
    supportedInApi: raw.supported_in_api ?? raw.supportedInApi ?? null,
  });
}

export function normalizeCodexModels(rawModels) {
  return normalizeModelList(rawModels);
}

export default Object.freeze({
  CODEX_FAST_SUPPORT_METADATA,
  CODEX_FALLBACK_MODELS,
  CODEX_REASONING_EFFORT_OPTIONS,
  discoverCodexModels,
  getCodexFastSupportMetadata,
  getCodexReasoningEffortOptions,
  normalizeCodexModel,
  normalizeCodexModels,
  parseCodexModelsOutput,
  resolveCodexCli,
  resolveCodexCliPath,
});

function parseJsonModels(text) {
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const models = extractModelsFromJson(parsed);
      if (models.length > 0) {
        return models;
      }
    } catch {
      // Keep trying less strict candidates before falling back to line parsing.
    }
  }
  return [];
}

function jsonCandidates(text) {
  const candidates = [text];
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.push(text.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    candidates.push(text.slice(arrayStart, arrayEnd + 1));
  }
  return [...new Set(candidates)];
}

function extractModelsFromJson(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!parsed || typeof parsed !== "object") {
    return [];
  }
  for (const key of ["models", "data", "items"]) {
    if (Array.isArray(parsed[key])) {
      return parsed[key];
    }
  }
  return [];
}

function parseTextModels(text) {
  const models = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^(?:[-*]\s*)?(?<slug>(?:gpt|o\d|codex|computer-use)[a-z0-9.-]*)(?:\s|$|[,([])/i);
    const slug = match?.groups?.slug;
    if (!slug) {
      continue;
    }
    models.push({
      slug,
      displayName: parseDisplayName(trimmed, slug),
      fast: /\bfast\b/i.test(trimmed),
      visibility: "text",
    });
  }
  return models;
}

function parseDisplayName(line, slug) {
  const rest = line.slice(line.indexOf(slug) + slug.length).replace(/^[\s:|,-]+/, "").trim();
  return rest.replace(/\s*\([^)]*\)\s*$/, "").trim() || slug;
}

function normalizeModelList(rawModels) {
  const seen = new Set();
  const normalized = [];
  for (const [index, raw] of Array.from(rawModels || []).entries()) {
    const model = normalizeCodexModel(raw, index);
    if (!model || seen.has(model.slug)) {
      continue;
    }
    seen.add(model.slug);
    normalized.push(model);
  }
  normalized.sort((left, right) => left.priority - right.priority || left.slug.localeCompare(right.slug));
  return Object.freeze(normalized);
}

function normalizeReasoningEfforts(value) {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
    : Object.entries(value || {}).map(([effort, description]) => ({ effort, description }));
  return reasoningEfforts(entries.map((entry) => typeof entry === "string" ? entry : entry?.effort || entry?.value || entry?.name), entries);
}

function reasoningEfforts(values, rawEntries = []) {
  const seen = new Set();
  const options = [];
  for (const [index, value] of values.entries()) {
    const effort = String(value || "").trim();
    if (!effort || seen.has(effort)) {
      continue;
    }
    seen.add(effort);
    const rawEntry = rawEntries[index];
    const description = typeof rawEntry === "object" && rawEntry
      ? String(rawEntry.description || "").trim()
      : "";
    options.push(freezeReasoningOption({
      value: effort,
      label: REASONING_LABELS[effort] || titleCase(effort),
      description: description || REASONING_DESCRIPTIONS[effort] || "",
    }));
  }
  return Object.freeze(options);
}

function extractFastSupport(raw) {
  const tierFields = CODEX_FAST_SUPPORT_METADATA.modelFields;
  for (const field of tierFields) {
    const snakeField = toSnakeCase(field);
    const value = raw[field] ?? raw[snakeField];
    if (Array.isArray(value) && value.map(speedTierValue).includes(FAST_TIER)) {
      return freezeFastSupport({ supported: true, source: field });
    }
  }
  if (raw.fast === true || raw.supports_fast === true || raw.supportsFast === true) {
    return freezeFastSupport({ supported: true, source: "boolean" });
  }
  if (raw.fast?.supported === true) {
    return freezeFastSupport({ supported: true, source: raw.fast.source || "fast" });
  }
  return freezeFastSupport({ supported: false, source: "" });
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

function withDiscoveryMetadata(models, metadata) {
  return Object.freeze({
    models: Object.freeze([...models]),
    reasoningEfforts: CODEX_REASONING_EFFORT_OPTIONS,
    fast: getCodexFastSupportMetadata(models),
    source: metadata.source,
    codexCliPath: metadata.codexCliPath,
    command: metadata.command,
    errors: Object.freeze(metadata.errors || []),
  });
}

function firstNonEmpty(values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function freezeModel(model) {
  return Object.freeze({
    ...model,
    reasoningEfforts: Object.freeze(model.reasoningEfforts || []),
    fast: Object.freeze(model.fast || freezeFastSupport({ supported: false, source: "" })),
  });
}

function freezeReasoningOption(option) {
  return Object.freeze(option);
}

function freezeFastSupport(value) {
  return Object.freeze({
    supported: Boolean(value.supported),
    tier: value.tier || FAST_TIER,
    source: value.source || "",
  });
}

function titleCase(value) {
  return String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function speedTierValue(value) {
  if (value && typeof value === "object") {
    return String(value.tier || value.name || value.value || "").toLowerCase();
  }
  return String(value || "").toLowerCase();
}

function toSnakeCase(value) {
  return String(value).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
