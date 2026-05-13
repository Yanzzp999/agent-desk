import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const DEFAULT_TASK_DIRNAME = "task";
export const DEFAULT_TASK_FILE_SUFFIX = ".task.md";

export async function createTaskMarkdownFile(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const taskDir = path.resolve(projectRoot, options.taskDir || DEFAULT_TASK_DIRNAME);
  const title = normalizeTitle(options.title || firstSentence(options.brief) || "Task");
  const tasks = normalizeTaskItems(options.tasks || extractTaskItems(options.brief));
  const filename = normalizeTaskFilename(options.filename || `${slug(title)}${DEFAULT_TASK_FILE_SUFFIX}`);
  const filePath = options.overwrite
    ? path.join(taskDir, filename)
    : await uniqueTaskFilePath(taskDir, filename);
  const markdown = renderTaskMarkdown({
    title,
    brief: normalizeOptionalString(options.brief),
    tasks,
  });

  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(filePath, markdown, "utf8");
  return {
    projectRoot,
    taskDir,
    filePath,
    filename: path.basename(filePath),
    title,
    tasks,
    markdown,
  };
}

export async function listTaskMarkdownFiles(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const taskDir = path.resolve(projectRoot, options.taskDir || DEFAULT_TASK_DIRNAME);
  const entries = await fs.readdir(taskDir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const filePath = path.join(taskDir, entry.name);
    const markdown = await fs.readFile(filePath, "utf8");
    items.push({
      filename: entry.name,
      filePath,
      title: extractMarkdownTitle(markdown) || entry.name,
      taskCount: countChecklistItems(markdown),
    });
  }
  items.sort((left, right) => left.filename.localeCompare(right.filename));
  return { projectRoot, taskDir, items };
}

export async function readTaskMarkdownFile(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const taskDir = path.resolve(projectRoot, options.taskDir || DEFAULT_TASK_DIRNAME);
  const filename = requiredString(options.filename || options.file, "filename");
  const filePath = path.resolve(taskDir, filename);
  if (!filePath.startsWith(`${taskDir}${path.sep}`) && filePath !== taskDir) {
    throw new Error("filename must stay inside the task directory");
  }
  const markdown = await fs.readFile(filePath, "utf8");
  return {
    projectRoot,
    taskDir,
    filePath,
    filename: path.basename(filePath),
    title: extractMarkdownTitle(markdown) || path.basename(filePath),
    taskCount: countChecklistItems(markdown),
    markdown,
  };
}

export function renderTaskMarkdown(options = {}) {
  const title = normalizeTitle(options.title || "Task");
  const brief = normalizeOptionalString(options.brief);
  const tasks = normalizeTaskItems(options.tasks);
  const lines = [
    `# ${title}`,
    "",
  ];
  if (brief) {
    lines.push("## Goal", "", brief, "");
  }
  lines.push("## Tasks", "");
  for (const task of tasks) {
    lines.push(`- [ ] ${task}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function normalizeTaskItems(items = []) {
  const normalized = []
    .concat(items || [])
    .map((item) => normalizeTaskItem(item))
    .filter(Boolean);
  return normalized.length > 0
    ? uniqueStrings(normalized)
    : ["Define and implement the requested change"];
}

export function resolveProjectRoot(value) {
  return path.resolve(
    normalizeOptionalString(value)
      || normalizeOptionalString(process.env.AGENT_DESK_PROJECT_ROOT)
      || normalizeOptionalString(process.env.INIT_CWD)
      || process.cwd(),
  );
}

function extractTaskItems(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/);
      return match ? match[1] : "";
    })
    .filter(Boolean);
}

async function uniqueTaskFilePath(taskDir, filename) {
  const parsed = path.parse(filename);
  let candidate = path.join(taskDir, filename);
  let suffix = 2;
  while (await exists(candidate)) {
    candidate = path.join(taskDir, `${parsed.name}-${suffix}${parsed.ext}`);
    suffix += 1;
  }
  return candidate;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeTaskFilename(value) {
  const filename = path.basename(normalizeOptionalString(value) || `task${DEFAULT_TASK_FILE_SUFFIX}`);
  if (!filename.endsWith(".md")) {
    return `${slug(filename)}${DEFAULT_TASK_FILE_SUFFIX}`;
  }
  return filename;
}

function normalizeTaskItem(value) {
  return String(value || "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(value) {
  return requiredString(value, "title").replace(/\s+/g, " ").trim();
}

function requiredString(value, label) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw new Error(`${label} is required`);
  }
  return text;
}

function normalizeOptionalString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function extractMarkdownTitle(markdown) {
  const match = String(markdown || "").match(/^#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : "";
}

function countChecklistItems(markdown) {
  return String(markdown || "")
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+/.test(line))
    .length;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function slug(value) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || "task";
}

function firstSentence(text) {
  const line = String(text || "").split(/\r?\n/).find((entry) => entry.trim()) || "";
  return line.trim().slice(0, 96);
}
