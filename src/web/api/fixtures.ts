import type { AgentDeskTask, AgentDeskTaskDetail, SessionSummary } from "./types";

const DEMO_PROJECT_ROOT = "/Users/example/work/checkout-service";

function isoHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export const fixtureTasks: AgentDeskTask[] = [
  {
    taskId: "task-20260525-agentdesk-ui",
    title: "Build AgentDesk task queue UI",
    brief:
      "Create a React task management surface that keeps task.md, claims, dispatches, and session history visible.",
    status: "running",
    priority: "urgent",
    scope: "project",
    taskType: "coding",
    projectRoot: DEMO_PROJECT_ROOT,
    createdAt: isoHoursFromNow(-30),
    updatedAt: isoHoursFromNow(-2),
    dueAt: isoHoursFromNow(8),
    tags: ["ui", "task.md", "sessions"],
    subtaskCount: 8,
    completedSubtasks: 5,
    claimedBy: "worker-e",
    activeSessionId: "session-20260525-ui-runtime",
    activeSessionStatus: "running",
    paths: {
      taskMd: `${DEMO_PROJECT_ROOT}/.agent-desk/tasks/task-20260525-agentdesk-ui/task.md`,
      memoryMd: `${DEMO_PROJECT_ROOT}/.agent-desk/tasks/task-20260525-agentdesk-ui/memory.md`,
    },
  },
  {
    taskId: "task-20260524-local-api",
    title: "Expose local AgentDesk HTTP API",
    brief:
      "Back the web runtime with a Node.js ESM HTTP API and SQLite persistence while preserving MCP stdio behavior.",
    status: "ready",
    priority: "high",
    scope: "project",
    taskType: "coding",
    projectRoot: DEMO_PROJECT_ROOT,
    createdAt: isoHoursFromNow(-52),
    updatedAt: isoHoursFromNow(-6),
    dueAt: isoHoursFromNow(30),
    tags: ["api", "sqlite", "mcp"],
    subtaskCount: 7,
    completedSubtasks: 2,
    paths: {
      taskMd: `${DEMO_PROJECT_ROOT}/.agent-desk/tasks/task-20260524-local-api/task.md`,
      memoryMd: `${DEMO_PROJECT_ROOT}/.agent-desk/tasks/task-20260524-local-api/memory.md`,
    },
  },
  {
    taskId: "task-20260522-docs-refresh",
    title: "Refresh AgentDesk user docs",
    brief:
      "Document the supported CLI, MCP stdio, web task workflow, and validation expectations without legacy compatibility paths.",
    status: "blocked",
    priority: "normal",
    scope: "project",
    taskType: "coding",
    projectRoot: DEMO_PROJECT_ROOT,
    createdAt: isoHoursFromNow(-88),
    updatedAt: isoHoursFromNow(-18),
    dueAt: isoHoursFromNow(96),
    tags: ["docs", "workflow"],
    subtaskCount: 4,
    completedSubtasks: 1,
    claimedBy: "docs-worker",
    paths: {
      taskMd: `${DEMO_PROJECT_ROOT}/.agent-desk/tasks/task-20260522-docs-refresh/task.md`,
      memoryMd: `${DEMO_PROJECT_ROOT}/.agent-desk/tasks/task-20260522-docs-refresh/memory.md`,
    },
  },
  {
    taskId: "task-20260518-session-history",
    title: "Audit session history rendering",
    brief:
      "Verify session.md summaries expose subagent reports, last errors, and launch plan metadata for review.",
    status: "succeeded",
    priority: "normal",
    scope: "project",
    taskType: "coding",
    projectRoot: DEMO_PROJECT_ROOT,
    createdAt: isoHoursFromNow(-170),
    updatedAt: isoHoursFromNow(-42),
    dueAt: isoHoursFromNow(250),
    tags: ["sessions", "audit"],
    subtaskCount: 6,
    completedSubtasks: 6,
    paths: {
      taskMd: `${DEMO_PROJECT_ROOT}/.agent-desk/tasks/task-20260518-session-history/task.md`,
      memoryMd: `${DEMO_PROJECT_ROOT}/.agent-desk/tasks/task-20260518-session-history/memory.md`,
    },
  },
];

export const fixtureSessions: SessionSummary[] = [
  {
    sessionId: "session-20260525-ui-runtime",
    taskId: "task-20260525-agentdesk-ui",
    taskTitle: "Build AgentDesk task queue UI",
    status: "running",
    startedAt: isoHoursFromNow(-3),
    model: "gpt-5.5",
    reasoning: "xhigh",
    serviceTier: "fast",
    parallel: 6,
    launchBatchSize: 6,
    agents: {
      total: 6,
      running: 2,
      succeeded: 3,
      failed: 1,
    },
    lastError: "One worker reported overlapping package.json edits; review before merge.",
  },
  {
    sessionId: "session-20260524-api-design",
    taskId: "task-20260524-local-api",
    taskTitle: "Expose local AgentDesk HTTP API",
    status: "waiting_for_app",
    startedAt: isoHoursFromNow(-10),
    model: "gpt-5.5",
    reasoning: "xhigh",
    serviceTier: "fast",
    parallel: 6,
    launchBatchSize: 6,
    agents: {
      total: 4,
      running: 0,
      succeeded: 0,
      failed: 0,
    },
  },
  {
    sessionId: "session-20260518-history-check",
    taskId: "task-20260518-session-history",
    taskTitle: "Audit session history rendering",
    status: "succeeded",
    startedAt: isoHoursFromNow(-60),
    finishedAt: isoHoursFromNow(-42),
    model: "gpt-5.5",
    reasoning: "xhigh",
    serviceTier: "fast",
    parallel: 6,
    launchBatchSize: 6,
    agents: {
      total: 6,
      running: 0,
      succeeded: 6,
      failed: 0,
    },
  },
];

export function buildFixtureTaskDetail(task: AgentDeskTask): AgentDeskTaskDetail {
  const recentSessions = fixtureSessions.filter((session) => session.taskId === task.taskId);

  return {
    ...task,
    markdown: [
      `# ${task.title}`,
      "",
      "## Goal",
      task.brief,
      "",
      "## Subtasks",
      "- [x] Confirm task.md remains the visible source of work.",
      "- [x] Keep MCP stdio and verunectl as primary interfaces.",
      "- [ ] Validate local HTTP API integration.",
      "- [ ] Record session history after dispatch.",
    ].join("\n"),
    memory: [
      `# Task Memory: ${task.title}`,
      "",
      `- Task ID: ${task.taskId}`,
      `- Project root: ${task.projectRoot}`,
      "- Defaults: gpt-5.5, xhigh, fast, launch batch size 6.",
    ].join("\n"),
    recentSessions,
  };
}
