import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const DEFAULT_TASK_DIRNAME = "task";
export const DEFAULT_TASK_FILE_SUFFIX = ".task.md";
const CLAIM_LINE_RE = /^\s*[-*+]\s+AgentDesk claim:\s+`([^`]+)`\s+at\s+([^;]+?)(?:;\s+note:\s+(.+?))?\s*$/;

export async function createTaskMarkdownFile(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const taskDir = path.resolve(projectRoot, options.taskDir || DEFAULT_TASK_DIRNAME);
  const title = normalizeTitle(options.title || firstSentence(options.brief) || "Task");
  const tasks = normalizeTaskItems(options.tasks || extractTaskItems(options.brief));
  const filename = normalizeTaskFilename(options.filename || `${slug(title)}${DEFAULT_TASK_FILE_SUFFIX}`);
  const markdown = renderTaskMarkdown({
    title,
    brief: normalizeOptionalString(options.brief),
    tasks,
  });
  const filePath = options.overwrite
    ? path.join(taskDir, filename)
    : await writeUniqueTaskFile(taskDir, filename, markdown);

  await fs.mkdir(taskDir, { recursive: true });
  if (options.overwrite) {
    await fs.writeFile(filePath, markdown, "utf8");
  }
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
      ...summarizeTaskMarkdown(markdown, entry.name),
    });
  }
  items.sort((left, right) => left.filename.localeCompare(right.filename));
  return { projectRoot, taskDir, items };
}

export async function readTaskMarkdownFile(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const taskDir = path.resolve(projectRoot, options.taskDir || DEFAULT_TASK_DIRNAME);
  const taskName = requiredString(options.filename || options.file || options.taskName, "filename");
  const resolved = await resolveTaskMarkdownFile(taskDir, taskName);
  const filePath = resolved.filePath;
  const markdown = await fs.readFile(filePath, "utf8");
  return {
    projectRoot,
    taskDir,
    filePath,
    filename: path.basename(filePath),
    ...summarizeTaskMarkdown(markdown, path.basename(filePath)),
    markdown,
  };
}

export async function claimTaskMarkdownItems(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const taskDir = path.resolve(projectRoot, options.taskDir || DEFAULT_TASK_DIRNAME);
  const taskName = requiredString(options.taskName || options.filename || options.file, "taskName");
  const selectors = normalizeClaimSelectors(options.items || options.item || options.taskItems);
  const assignee = normalizeAssignee(
    options.assignee
      || options.agent
      || process.env.AGENT_DESK_AGENT_NAME
      || process.env.CODEX_SESSION_ID
      || "agent",
  );
  const claimedAt = normalizeClaimedAt(options.claimedAt);
  const note = normalizeClaimNote(options.note);
  const force = Boolean(options.force);
  const resolved = await resolveTaskMarkdownFile(taskDir, taskName);
  const markdown = await fs.readFile(resolved.filePath, "utf8");
  const summary = summarizeTaskMarkdown(markdown, resolved.filename);
  if (summary.items.length === 0) {
    throw new Error(`task has no checklist items: ${resolved.filename}`);
  }

  const selected = selectTaskItems(summary.items, selectors);
  const completed = selected.filter((item) => item.checked);
  if (completed.length > 0) {
    throw new Error(`cannot claim completed item(s): ${completed.map((item) => item.index).join(", ")}`);
  }
  const conflicts = selected.filter((item) => item.claimedBy && item.claimedBy !== assignee);
  if (conflicts.length > 0 && !force) {
    throw new Error(`item(s) already claimed: ${conflicts.map((item) => `${item.index} by ${item.claimedBy}`).join(", ")}`);
  }

  const updatedMarkdown = applyTaskItemClaims(markdown, selected, { assignee, claimedAt, note });
  await fs.writeFile(resolved.filePath, updatedMarkdown, "utf8");
  const updatedSummary = summarizeTaskMarkdown(updatedMarkdown, resolved.filename);
  const claimed = selected.map((item) => updatedSummary.items[item.index - 1]).filter(Boolean);
  return {
    projectRoot,
    taskDir,
    filePath: resolved.filePath,
    filename: resolved.filename,
    ...updatedSummary,
    markdown: updatedMarkdown,
    claimed,
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

async function writeUniqueTaskFile(taskDir, filename, markdown) {
  await fs.mkdir(taskDir, { recursive: true });
  const parsed = path.parse(filename);
  let candidate = path.join(taskDir, filename);
  let suffix = 2;
  while (true) {
    let handle = null;
    try {
      handle = await fs.open(candidate, "wx");
      await handle.writeFile(markdown, "utf8");
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      candidate = path.join(taskDir, `${parsed.name}-${suffix}${parsed.ext}`);
      suffix += 1;
    } finally {
      await handle?.close();
    }
  }
}

function normalizeTaskFilename(value) {
  const filename = path.basename(normalizeOptionalString(value) || `task${DEFAULT_TASK_FILE_SUFFIX}`);
  if (!filename.endsWith(".md")) {
    return `${slug(filename)}${DEFAULT_TASK_FILE_SUFFIX}`;
  }
  return filename;
}

async function resolveTaskMarkdownFile(taskDir, taskName) {
  const requested = requiredString(taskName, "taskName");
  const requestedBase = path.basename(requested);
  const entries = await fs.readdir(taskDir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
  const filenameCandidates = new Set([
    requestedBase,
    requestedBase.endsWith(".md") ? requestedBase : `${requestedBase}.md`,
    requestedBase.endsWith(".md") ? requestedBase : `${requestedBase}${DEFAULT_TASK_FILE_SUFFIX}`,
    `${slug(requestedBase)}${DEFAULT_TASK_FILE_SUFFIX}`,
  ].map((value) => value.toLowerCase()));
  const directMatches = files.filter((filename) => filenameCandidates.has(filename.toLowerCase()));
  if (directMatches.length === 1) {
    return {
      filename: directMatches[0],
      filePath: path.join(taskDir, directMatches[0]),
    };
  }
  if (directMatches.length > 1) {
    throw new Error(`task name is ambiguous: ${requested}`);
  }

  const titleMatches = [];
  const requestedTitle = requested.toLowerCase();
  const requestedSlug = slug(requested);
  for (const filename of files) {
    const filePath = path.join(taskDir, filename);
    const markdown = await fs.readFile(filePath, "utf8");
    const title = extractMarkdownTitle(markdown) || filename;
    if (title.toLowerCase() === requestedTitle || slug(title) === requestedSlug) {
      titleMatches.push({ filename, filePath });
    }
  }
  if (titleMatches.length === 1) {
    return titleMatches[0];
  }
  if (titleMatches.length > 1) {
    throw new Error(`task name is ambiguous: ${requested}`);
  }
  throw new Error(`task not found: ${requested}`);
}

function normalizeTaskItem(value) {
  return String(value || "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeTaskMarkdown(markdown, fallbackTitle = "Task") {
  const items = extractChecklistItems(markdown);
  const doneCount = items.filter((item) => item.checked).length;
  const claimedCount = items.filter((item) => item.claimedBy).length;
  return {
    title: extractMarkdownTitle(markdown) || fallbackTitle,
    taskCount: items.length,
    openCount: items.length - doneCount,
    doneCount,
    claimedCount,
    items,
  };
}

function extractChecklistItems(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const items = [];
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const itemMatch = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (itemMatch) {
      current = {
        index: items.length + 1,
        line: index + 1,
        lineIndex: index,
        indent: itemMatch[1] || "",
        title: itemMatch[3].trim(),
        checked: itemMatch[2].toLowerCase() === "x",
        claimedBy: "",
        claimedAt: "",
        claimNote: "",
        claimLine: 0,
        claimLineIndex: -1,
      };
      items.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    const claim = parseClaimLine(line);
    if (claim && !current.claimedBy) {
      current.claimedBy = claim.assignee;
      current.claimedAt = claim.claimedAt;
      current.claimNote = claim.note;
      current.claimLine = index + 1;
      current.claimLineIndex = index;
    }
  }
  return items.map(({ indent, lineIndex, claimLineIndex, ...item }) => item);
}

function extractChecklistItemsForEditing(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const items = [];
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const itemMatch = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (itemMatch) {
      current = {
        index: items.length + 1,
        lineIndex: index,
        indent: itemMatch[1] || "",
        title: itemMatch[3].trim(),
        checked: itemMatch[2].toLowerCase() === "x",
        claimedBy: "",
        claimLineIndex: -1,
      };
      items.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    const claim = parseClaimLine(line);
    if (claim && !current.claimedBy) {
      current.claimedBy = claim.assignee;
      current.claimLineIndex = index;
    }
  }
  return items;
}

function parseClaimLine(line) {
  const match = String(line || "").match(CLAIM_LINE_RE);
  if (!match) {
    return null;
  }
  return {
    assignee: match[1],
    claimedAt: match[2].trim(),
    note: (match[3] || "").trim(),
  };
}

function normalizeClaimSelectors(value) {
  const selectors = []
    .concat(value || [])
    .map((item) => typeof item === "number" ? item : String(item || "").trim())
    .filter((item) => item !== "");
  if (selectors.length === 0) {
    throw new Error("at least one item selector is required");
  }
  return selectors;
}

function selectTaskItems(items, selectors) {
  return uniqueIndexes(selectors.map((selector) => selectTaskItem(items, selector)))
    .map((index) => items[index - 1]);
}

function selectTaskItem(items, selector) {
  if (typeof selector === "number" || /^\d+$/.test(selector)) {
    const index = Number(selector);
    if (!Number.isInteger(index) || index < 1 || index > items.length) {
      throw new Error(`item index is out of range: ${selector}`);
    }
    return index;
  }
  const normalized = String(selector).trim().toLowerCase();
  const exact = items.filter((item) => item.title.toLowerCase() === normalized);
  if (exact.length === 1) {
    return exact[0].index;
  }
  if (exact.length > 1) {
    throw new Error(`item selector is ambiguous: ${selector}`);
  }
  const partial = items.filter((item) => item.title.toLowerCase().includes(normalized));
  if (partial.length === 1) {
    return partial[0].index;
  }
  if (partial.length > 1) {
    throw new Error(`item selector is ambiguous: ${selector}`);
  }
  throw new Error(`item not found: ${selector}`);
}

function uniqueIndexes(indexes) {
  return [...new Set(indexes)];
}

function applyTaskItemClaims(markdown, selectedItems, claim) {
  const lines = String(markdown || "").split(/\r?\n/);
  const editableItems = extractChecklistItemsForEditing(markdown);
  const selectedIndexes = new Set(selectedItems.map((item) => item.index));
  const claimLineByIndex = new Map(
    editableItems
      .filter((item) => selectedIndexes.has(item.index))
      .map((item) => [item.index, item]),
  );
  for (const item of [...claimLineByIndex.values()].sort((left, right) => right.lineIndex - left.lineIndex)) {
    const claimLine = renderClaimLine(item.indent, claim);
    if (item.claimLineIndex >= 0) {
      lines[item.claimLineIndex] = claimLine;
    } else {
      lines.splice(item.lineIndex + 1, 0, claimLine);
    }
  }
  return lines.join("\n");
}

function renderClaimLine(indent, claim) {
  const note = claim.note ? `; note: ${claim.note}` : "";
  return `${indent}  - AgentDesk claim: \`${claim.assignee}\` at ${claim.claimedAt}${note}`;
}

function normalizeAssignee(value) {
  const assignee = requiredString(value, "assignee")
    .replace(/[`<>\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!assignee) {
    throw new Error("assignee is required");
  }
  return assignee;
}

function normalizeClaimedAt(value) {
  const text = normalizeOptionalString(value);
  if (!text) {
    return new Date().toISOString();
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error("claimedAt must be a valid date");
  }
  return date.toISOString();
}

function normalizeClaimNote(value) {
  return normalizeOptionalString(value)
    .replace(/[\r\n]/g, " ")
    .replace(/\s+/g, " ");
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
