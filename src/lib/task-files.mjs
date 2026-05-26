import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const DEFAULT_TASK_DIRNAME = "task";
export const DEFAULT_TASK_FILE_SUFFIX = ".task.md";
const CLAIM_LINE_RE = /^\s*[-*+]\s+AgentDesk claim:\s+`([^`]+)`\s+at\s+([^;]+)(.*)$/;

export async function createTaskMarkdownFile(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const taskDir = resolveTaskDir(projectRoot, options.taskDir);
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
  const taskDir = resolveTaskDir(projectRoot, options.taskDir);
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
  const taskDir = resolveTaskDir(projectRoot, options.taskDir);
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
  const taskDir = resolveTaskDir(projectRoot, options.taskDir);
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
  const sessionId = requiredClaimSessionId(options.sessionId || options.session || process.env.CODEX_SESSION_ID);
  const note = normalizeClaimNote(options.note);
  const force = Boolean(options.force);
  const resolved = await resolveTaskMarkdownFile(taskDir, taskName);

  return withTaskMarkdownLock(projectRoot, resolved.filePath, async () => {
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
    const conflicts = selected.filter((item) => isClaimConflict(item, assignee, sessionId));
    if (conflicts.length > 0 && !force) {
      throw new Error(`item(s) already claimed: ${conflicts.map(formatClaimConflict).join(", ")}`);
    }

    const updatedMarkdown = applyTaskItemClaims(markdown, selected, {
      assignee,
      claimedAt,
      sessionId,
      note,
    });
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
  });
}

export async function claimNextTaskMarkdownItem(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const taskDir = resolveTaskDir(projectRoot, options.taskDir);
  const taskName = requiredString(options.taskName || options.filename || options.file, "taskName");
  const assignee = normalizeAssignee(
    options.assignee
      || options.agent
      || process.env.AGENT_DESK_AGENT_NAME
      || process.env.CODEX_SESSION_ID,
  );
  const sessionId = requiredClaimSessionId(options.sessionId || options.session || process.env.CODEX_SESSION_ID);
  const claimedAt = normalizeClaimedAt(options.claimedAt);
  const note = normalizeClaimNote(options.note || "implementing");
  const resolved = await resolveTaskMarkdownFile(taskDir, taskName);

  return withTaskMarkdownLock(projectRoot, resolved.filePath, async () => {
    const markdown = await fs.readFile(resolved.filePath, "utf8");
    const summary = summarizeTaskMarkdown(markdown, resolved.filename);
    if (summary.items.length === 0) {
      throw new Error(`task has no checklist items: ${resolved.filename}`);
    }

    const next = summary.items.find((item) => !item.checked && !item.claimedBy);
    if (!next) {
      return {
        projectRoot,
        taskDir,
        filePath: resolved.filePath,
        filename: resolved.filename,
        ...summary,
        markdown,
        hasWork: false,
        claimed: [],
      };
    }

    const updatedMarkdown = applyTaskItemClaims(markdown, [next], {
      assignee,
      claimedAt,
      sessionId,
      note,
    });
    await fs.writeFile(resolved.filePath, updatedMarkdown, "utf8");
    const updatedSummary = summarizeTaskMarkdown(updatedMarkdown, resolved.filename);
    const claimed = [updatedSummary.items[next.index - 1]].filter(Boolean);
    return {
      projectRoot,
      taskDir,
      filePath: resolved.filePath,
      filename: resolved.filename,
      ...updatedSummary,
      markdown: updatedMarkdown,
      hasWork: true,
      claimed,
    };
  });
}

export async function completeTaskMarkdownItems(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const taskDir = resolveTaskDir(projectRoot, options.taskDir);
  const taskName = requiredString(options.taskName || options.filename || options.file, "taskName");
  const selectors = normalizeClaimSelectors(options.items || options.item || options.taskItems);
  const assignee = normalizeAssignee(options.assignee || options.agent || process.env.AGENT_DESK_AGENT_NAME);
  const sessionId = requiredClaimSessionId(options.sessionId || options.session || process.env.CODEX_SESSION_ID);
  const resolved = await resolveTaskMarkdownFile(taskDir, taskName);

  return withTaskMarkdownLock(projectRoot, resolved.filePath, async () => {
    const markdown = await fs.readFile(resolved.filePath, "utf8");
    const summary = summarizeTaskMarkdown(markdown, resolved.filename);
    if (summary.items.length === 0) {
      throw new Error(`task has no checklist items: ${resolved.filename}`);
    }

    const selected = selectTaskItems(summary.items, selectors);
    const unauthorized = selected.filter((item) => {
      if (item.checked && !item.claimedBy) {
        return false;
      }
      return !isClaimOwnedBy(item, assignee, sessionId);
    });
    if (unauthorized.length > 0) {
      throw new Error(`item(s) not claimed by ${assignee}/${sessionId}: ${unauthorized.map(formatClaimConflict).join(", ")}`);
    }

    const updatedMarkdown = applyTaskItemCompletion(markdown, selected);
    await fs.writeFile(resolved.filePath, updatedMarkdown, "utf8");
    const updatedSummary = summarizeTaskMarkdown(updatedMarkdown, resolved.filename);
    const completed = selected.map((item) => updatedSummary.items[item.index - 1]).filter(Boolean);
    return {
      projectRoot,
      taskDir,
      filePath: resolved.filePath,
      filename: resolved.filename,
      ...updatedSummary,
      markdown: updatedMarkdown,
      completed,
    };
  });
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

export function resolveTaskDir(projectRoot, value) {
  const taskDir = normalizeOptionalString(value) || DEFAULT_TASK_DIRNAME;
  if (path.isAbsolute(taskDir)) {
    throw new Error("taskDir must be relative to projectRoot");
  }
  const resolved = path.resolve(projectRoot, taskDir);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("taskDir must stay inside projectRoot");
  }
  return resolved;
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
        claimSessionId: "",
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
      current.claimSessionId = claim.sessionId;
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
        claimSessionId: "",
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
      current.claimSessionId = claim.sessionId;
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
  const suffix = match[3] || "";
  const sessionMatch = suffix.match(/;\s*session:\s*`([^`]+)`/);
  const noteMatch = suffix.match(/;\s*note:\s*(.+?)(?=;\s*[A-Za-z]+:|$)/);
  return {
    assignee: match[1],
    claimedAt: match[2].trim(),
    sessionId: (sessionMatch?.[1] || "").trim(),
    note: (noteMatch?.[1] || "").trim(),
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

function applyTaskItemCompletion(markdown, selectedItems) {
  const lines = String(markdown || "").split(/\r?\n/);
  const editableItems = extractChecklistItemsForEditing(markdown);
  const selectedIndexes = new Set(selectedItems.map((item) => item.index));
  const itemsToComplete = editableItems
    .filter((candidate) => selectedIndexes.has(candidate.index))
    .sort((left, right) => right.lineIndex - left.lineIndex);
  for (const item of itemsToComplete) {
    lines[item.lineIndex] = lines[item.lineIndex].replace(
      /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\](\s+.+?)\s*$/,
      "$1[x]$2",
    );
    if (item.claimLineIndex >= 0) {
      lines.splice(item.claimLineIndex, 1);
    }
  }
  return lines.join("\n");
}

function renderClaimLine(indent, claim) {
  const session = claim.sessionId ? `; session: \`${claim.sessionId}\`` : "";
  const note = claim.note ? `; note: ${claim.note}` : "";
  return `${indent}  - AgentDesk claim: \`${claim.assignee}\` at ${claim.claimedAt}${session}${note}`;
}

function isClaimConflict(item, assignee, sessionId) {
  if (!item.claimedBy) {
    return false;
  }
  if (item.claimedBy !== assignee) {
    return true;
  }
  return item.claimSessionId !== sessionId;
}

function isClaimOwnedBy(item, assignee, sessionId) {
  return item.claimedBy === assignee && item.claimSessionId === sessionId;
}

function formatClaimConflict(item) {
  const owner = item.claimedBy || "unclaimed";
  const session = item.claimSessionId ? `/${item.claimSessionId}` : "";
  return `${item.index} by ${owner}${session}`;
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

function normalizeClaimSessionId(value) {
  return normalizeOptionalString(value)
    .replace(/[`<>\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requiredClaimSessionId(value) {
  const sessionId = normalizeClaimSessionId(value);
  if (!sessionId) {
    throw new Error("sessionId is required");
  }
  return sessionId;
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

async function withTaskMarkdownLock(projectRoot, filePath, callback) {
  const lock = await acquireLock(taskMarkdownLockPath(projectRoot, filePath));
  try {
    return await callback();
  } finally {
    await releaseLock(lock);
  }
}

function taskMarkdownLockPath(projectRoot, filePath) {
  const hash = crypto.createHash("sha256").update(path.resolve(filePath)).digest("hex").slice(0, 16);
  return path.join(projectRoot, ".agent-desk", "locks", `task-markdown-${hash}.lock`);
}

async function acquireLock(lockPath) {
  const started = Date.now();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  while (true) {
    try {
      await fs.mkdir(lockPath, { recursive: false });
      await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }, null, 2), "utf8");
      return { lockPath };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      if (await removeStaleLock(lockPath)) {
        continue;
      }
      if (Date.now() - started > 30 * 60 * 1000) {
        throw new Error(`timed out waiting for lock: ${lockPath}`);
      }
      await sleep(100);
    }
  }
}

async function releaseLock(lock) {
  if (!lock?.lockPath) {
    return;
  }
  await fs.rm(lock.lockPath, { recursive: true, force: true });
}

async function removeStaleLock(lockPath) {
  const ownerPath = path.join(lockPath, "owner.json");
  let owner = null;
  try {
    owner = JSON.parse(await fs.readFile(ownerPath, "utf8"));
  } catch {
    owner = null;
  }
  const pid = Number(owner?.pid);
  if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    const stat = await fs.stat(lockPath).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs < 30 * 60 * 1000) {
      return false;
    }
  }
  await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
  return true;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
