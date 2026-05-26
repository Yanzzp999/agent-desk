import { constants as FS_CONSTANTS } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const CODING_TASK_TYPE = "coding";
export const DEFAULT_WORKSPACE_ROOT_MARKERS = Object.freeze([
  ".agent-desk",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "yarn.lock",
  "package.json",
  "go.work",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
  ".git",
]);

export function normalizeTaskType(value) {
  return normalizeString(value).toLowerCase();
}

export async function validateTaskProjectRoot(input = {}, options = {}) {
  const taskType = normalizeTaskType(input.taskType);
  const projectRoot = normalizeString(input.projectRoot);
  if (taskType === CODING_TASK_TYPE) {
    return validateCodingProjectRoot({ taskType, projectRoot }, options);
  }
  if (!projectRoot) {
    return emptyProjectRootValidation(taskType);
  }
  return validateProjectRootPath({ taskType, projectRoot, required: false }, options);
}

export async function validateCodingProjectRoot(input = {}, options = {}) {
  const normalizedInput = normalizeProjectRootInput(input);
  const taskType = normalizeTaskType(normalizedInput.taskType || CODING_TASK_TYPE);
  return validateProjectRootPath({
    taskType,
    projectRoot: normalizedInput.projectRoot,
    required: true,
  }, options);
}

export async function detectGitRoot(startPath, options = {}) {
  return findAncestorWithMarker(path.resolve(String(startPath || "")), [".git"], options);
}

export async function detectWorkspaceRoot(startPath, options = {}) {
  const markers = normalizeWorkspaceMarkers(options.workspaceMarkers || DEFAULT_WORKSPACE_ROOT_MARKERS);
  return findAncestorWithMarker(path.resolve(String(startPath || "")), markers, options);
}

async function validateProjectRootPath(input, options) {
  const taskType = normalizeTaskType(input.taskType);
  const taskTypeMessage = taskType ? ` when taskType=${taskType}` : "";
  const rawProjectRoot = normalizeString(input.projectRoot);
  if (!rawProjectRoot) {
    if (input.required) {
      throw new Error(`projectRoot is required${taskTypeMessage}`);
    }
    return emptyProjectRootValidation(taskType);
  }
  if (!path.isAbsolute(rawProjectRoot)) {
    throw new Error(`projectRoot must be an absolute path${taskTypeMessage} (received ${quote(rawProjectRoot)})`);
  }

  const projectRoot = path.resolve(rawProjectRoot);
  const result = {
    taskType,
    projectRoot,
    required: Boolean(input.required),
    exists: false,
    readable: false,
    realProjectRoot: "",
    gitRoot: "",
    workspaceRoot: "",
  };

  const shouldStat = Boolean(options.checkExists || options.checkReadable || options.resolveRealPath);
  if (shouldStat) {
    const stat = await statPath(projectRoot, options).catch((error) => {
      throw new Error(`projectRoot must exist${taskTypeMessage} (missing: ${projectRoot})`, { cause: error });
    });
    result.exists = true;
    if (!stat.isDirectory()) {
      throw new Error(`projectRoot must be a directory${taskTypeMessage} (received: ${projectRoot})`);
    }
  }

  if (options.checkReadable) {
    await accessPath(projectRoot, FS_CONSTANTS.R_OK, options).catch((error) => {
      throw new Error(`projectRoot must be readable${taskTypeMessage} (received: ${projectRoot})`, { cause: error });
    });
    result.readable = true;
  }

  if (options.resolveRealPath || (result.exists && options.realpath !== false)) {
    result.realProjectRoot = await realpathPath(projectRoot, options).catch(() => "");
  }

  if (options.detectGitRoot || options.requireGitRoot) {
    result.gitRoot = await detectGitRoot(projectRoot, options);
    if (options.requireGitRoot && !result.gitRoot) {
      throw new Error(`projectRoot must be inside a Git worktree${taskTypeMessage} (received: ${projectRoot})`);
    }
  }

  if (options.detectWorkspaceRoot || options.requireWorkspaceRoot) {
    result.workspaceRoot = await detectWorkspaceRoot(projectRoot, options);
    if (options.requireWorkspaceRoot && !result.workspaceRoot) {
      const markers = normalizeWorkspaceMarkers(options.workspaceMarkers || DEFAULT_WORKSPACE_ROOT_MARKERS);
      throw new Error(
        `projectRoot must be inside a workspace root containing one of: ${markers.join(", ")}`
          + `${taskTypeMessage} (received: ${projectRoot})`,
      );
    }
  }

  return result;
}

async function findAncestorWithMarker(startPath, markers, options = {}) {
  const normalizedMarkers = normalizeWorkspaceMarkers(markers);
  let current = path.resolve(startPath);
  while (true) {
    for (const marker of normalizedMarkers) {
      if (await pathExists(path.join(current, marker), options)) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return "";
    }
    current = parent;
  }
}

async function pathExists(filePath, options) {
  try {
    await statPath(filePath, options);
    return true;
  } catch {
    return false;
  }
}

async function statPath(filePath, options) {
  const stat = options.stat || fs.stat;
  return stat(filePath);
}

async function accessPath(filePath, mode, options) {
  const access = options.access || fs.access;
  return access(filePath, mode);
}

async function realpathPath(filePath, options) {
  const realpath = options.realpath || fs.realpath;
  return realpath(filePath);
}

function normalizeProjectRootInput(input) {
  if (typeof input === "string") {
    return {
      taskType: CODING_TASK_TYPE,
      projectRoot: input,
    };
  }
  return {
    taskType: input?.taskType,
    projectRoot: input?.projectRoot,
  };
}

function normalizeWorkspaceMarkers(markers) {
  const normalized = []
    .concat(markers || [])
    .map((marker) => normalizeString(marker))
    .filter(Boolean)
    .filter((marker) => !path.isAbsolute(marker));
  return normalized.length > 0 ? [...new Set(normalized)] : [...DEFAULT_WORKSPACE_ROOT_MARKERS];
}

function emptyProjectRootValidation(taskType) {
  return {
    taskType,
    projectRoot: "",
    required: false,
    exists: false,
    readable: false,
    realProjectRoot: "",
    gitRoot: "",
    workspaceRoot: "",
  };
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function quote(value) {
  return JSON.stringify(String(value ?? ""));
}
