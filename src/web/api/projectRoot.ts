export interface ProjectRootValidation {
  valid: boolean;
  message: string;
}

const UNIX_ABSOLUTE_PATH = /^\/(?!$).+/;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/].+/;

export function validateProjectRoot(value: string): ProjectRootValidation {
  const projectRoot = value.trim();

  if (!projectRoot) {
    return {
      valid: false,
      message: "Enter the absolute coding projectRoot before creating, editing, claiming, or dispatching tasks.",
    };
  }

  if (projectRoot.startsWith("~")) {
    return {
      valid: false,
      message: "Expand '~' to a full absolute path so the local API and workers resolve the same project.",
    };
  }

  if (/\s$/.test(value) || /^\s/.test(value)) {
    return {
      valid: false,
      message: "Remove leading or trailing whitespace from projectRoot.",
    };
  }

  if (projectRoot.endsWith(".md") || projectRoot.endsWith("task.md")) {
    return {
      valid: false,
      message: "Use the repository root, not a task.md file path.",
    };
  }

  if (!UNIX_ABSOLUTE_PATH.test(projectRoot) && !WINDOWS_ABSOLUTE_PATH.test(projectRoot)) {
    return {
      valid: false,
      message: "projectRoot must be an absolute path, for example /Users/me/work/repo.",
    };
  }

  return {
    valid: true,
    message: "projectRoot looks valid for the local HTTP API and Codex subagent worktrees.",
  };
}
