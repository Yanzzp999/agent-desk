import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import {
  createContext,
  createSession,
  createTask,
  getCodexAppLaunchPlan,
  getSession,
  getTask,
  listSessions,
  listTasks,
} from "./control-plane.mjs";
import {
  claimTaskMarkdownItems,
  claimNextTaskMarkdownItem,
  completeTaskMarkdownItems,
  createTaskMarkdownFile,
  listTaskMarkdownFiles,
  readTaskMarkdownFile,
} from "./task-files.mjs";
import {
  claimOverallTask,
  createOverallTask,
  dispatchOverallTask,
  getOverallTask,
  listOverallTasks,
  serializeAgentDeskError,
  updateOverallTask,
} from "./overall-tasks.mjs";

export function createAgentDeskMcpServer(options = {}) {
  const server = new McpServer({
    name: "agent-desk",
    version: "0.1.0",
  });

  server.registerTool("create_task", {
    title: "Create Task Markdown",
    description: "Create a markdown task file under the project's task/ directory. Task items are always written as markdown checklist items.",
    inputSchema: {
      title: z.string().min(1).describe("Task title used for the H1 and default filename."),
      brief: z.string().optional().describe("Optional goal/context text to include before the checklist."),
      tasks: z.array(z.string().min(1)).optional().describe("Todo items. Each item will be normalized into '- [ ] ...' markdown checklist syntax."),
      projectRoot: z.string().optional().describe("Project root. Defaults to AGENT_DESK_PROJECT_ROOT, INIT_CWD, or the MCP server working directory."),
      taskDir: z.string().optional().describe("Task directory relative to projectRoot. Default: task."),
      filename: z.string().optional().describe("Optional markdown filename. Default: a slug from the title ending in .task.md."),
      overwrite: z.boolean().optional().describe("Overwrite the target file when filename already exists. Default: false, which creates a unique suffix."),
    },
    outputSchema: {
      projectRoot: z.string(),
      taskDir: z.string(),
      filePath: z.string(),
      filename: z.string(),
      title: z.string(),
      tasks: z.array(z.string()),
      markdown: z.string(),
    },
  }, async (args) => {
    const result = await createTaskMarkdownFile({
      ...args,
      projectRoot: args.projectRoot || options.projectRoot,
    });
    return toolResult(result, `Created ${result.filePath}`);
  });

  server.registerTool("list_tasks", {
    title: "List Task Markdown Files",
    description: "List markdown task files from the project's task/ directory.",
    inputSchema: {
      projectRoot: z.string().optional().describe("Project root. Defaults to AGENT_DESK_PROJECT_ROOT, INIT_CWD, or the MCP server working directory."),
      taskDir: z.string().optional().describe("Task directory relative to projectRoot. Default: task."),
    },
    outputSchema: {
      projectRoot: z.string(),
      taskDir: z.string(),
      items: z.array(z.object({
        filename: z.string(),
        filePath: z.string(),
        title: z.string(),
        taskCount: z.number(),
        openCount: z.number(),
        doneCount: z.number(),
        claimedCount: z.number(),
        items: z.array(taskItemSchema()),
      })),
    },
  }, async (args) => {
    const result = await listTaskMarkdownFiles({
      ...args,
      projectRoot: args.projectRoot || options.projectRoot,
    });
    return toolResult(result, `Found ${result.items.length} task file(s) in ${result.taskDir}`);
  });

  server.registerTool("read_task", {
    title: "Read Task Markdown",
    description: "Read a markdown task file from the project's task/ directory.",
    inputSchema: {
      filename: z.string().optional().describe("Task markdown filename inside task/."),
      taskName: z.string().optional().describe("Task filename, title, or title slug inside task/."),
      projectRoot: z.string().optional().describe("Project root. Defaults to AGENT_DESK_PROJECT_ROOT, INIT_CWD, or the MCP server working directory."),
      taskDir: z.string().optional().describe("Task directory relative to projectRoot. Default: task."),
    },
    outputSchema: {
      projectRoot: z.string(),
      taskDir: z.string(),
      filePath: z.string(),
      filename: z.string(),
      title: z.string(),
      taskCount: z.number(),
      openCount: z.number(),
      doneCount: z.number(),
      claimedCount: z.number(),
      items: z.array(taskItemSchema()),
      markdown: z.string(),
    },
  }, async (args) => {
    const result = await readTaskMarkdownFile({
      ...args,
      projectRoot: args.projectRoot || options.projectRoot,
    });
    return toolResult(result, result.markdown);
  });

  server.registerTool("claim_task_items", {
    title: "Claim Task Items",
    description: "Claim one or more checklist items in a markdown task file by task name, filename, or title. Claims are written back as visible AgentDesk claim markers so other agents can see ownership.",
    inputSchema: {
      taskName: z.string().min(1).describe("Task filename, title, or title slug inside task/. Examples: 'checkout-flow.task.md' or 'Checkout flow'."),
      items: z.array(z.union([z.number(), z.string().min(1)])).min(1).describe("Checklist item selectors. Use 1-based item numbers, exact titles, or unique title fragments."),
      assignee: z.string().optional().describe("Agent/session name to show in the claim marker. Defaults to AGENT_DESK_AGENT_NAME, CODEX_SESSION_ID, or 'agent'."),
      sessionId: z.string().optional().describe("Optional session id to write beside the claim marker."),
      note: z.string().optional().describe("Optional short note stored beside the claim marker."),
      force: z.boolean().optional().describe("Overwrite claims owned by another assignee. Default: false."),
      projectRoot: z.string().optional().describe("Project root. Defaults to AGENT_DESK_PROJECT_ROOT, INIT_CWD, or the MCP server working directory."),
      taskDir: z.string().optional().describe("Task directory relative to projectRoot. Default: task."),
    },
    outputSchema: {
      projectRoot: z.string(),
      taskDir: z.string(),
      filePath: z.string(),
      filename: z.string(),
      title: z.string(),
      taskCount: z.number(),
      openCount: z.number(),
      doneCount: z.number(),
      claimedCount: z.number(),
      items: z.array(taskItemSchema()),
      claimed: z.array(taskItemSchema()),
      markdown: z.string(),
    },
  }, async (args) => {
    const result = await claimTaskMarkdownItems({
      ...args,
      projectRoot: args.projectRoot || options.projectRoot,
    });
    return toolResult(result, `Claimed ${result.claimed.length} item(s) in ${result.filePath}`);
  });

  server.registerTool("claim_next_task_item", {
    title: "Claim Next Task Item",
    description: "Atomically claim the first open, unclaimed checklist item in a markdown task file. The visible claim marker includes assignee and session id so humans can see who is implementing it.",
    inputSchema: {
      taskName: z.string().min(1).describe("Task filename, title, or title slug inside task/."),
      assignee: z.string().min(1).describe("Agent name to show in the claim marker."),
      sessionId: z.string().min(1).describe("Session id to show in the claim marker."),
      note: z.string().optional().describe("Optional short note stored beside the claim marker. Default: implementing."),
      projectRoot: z.string().optional().describe("Project root. Defaults to AGENT_DESK_PROJECT_ROOT, INIT_CWD, or the MCP server working directory."),
      taskDir: z.string().optional().describe("Task directory relative to projectRoot. Default: task."),
    },
    outputSchema: {
      projectRoot: z.string(),
      taskDir: z.string(),
      filePath: z.string(),
      filename: z.string(),
      title: z.string(),
      taskCount: z.number(),
      openCount: z.number(),
      doneCount: z.number(),
      claimedCount: z.number(),
      hasWork: z.boolean(),
      items: z.array(taskItemSchema()),
      claimed: z.array(taskItemSchema()),
      markdown: z.string(),
    },
  }, async (args) => {
    const result = await claimNextTaskMarkdownItem({
      ...args,
      projectRoot: args.projectRoot || options.projectRoot,
    });
    const text = result.hasWork
      ? `Claimed item ${result.claimed[0]?.index || ""} in ${result.filePath}`
      : `No unclaimed checklist items remain in ${result.filePath}`;
    return toolResult(result, text);
  });

  server.registerTool("complete_task_items", {
    title: "Complete Task Items",
    description: "Atomically check off checklist items previously claimed by the same assignee and session id.",
    inputSchema: {
      taskName: z.string().min(1).describe("Task filename, title, or title slug inside task/."),
      items: z.array(z.union([z.number(), z.string().min(1)])).min(1).describe("Checklist item selectors. Use 1-based item numbers, exact titles, or unique title fragments."),
      assignee: z.string().min(1).describe("Agent name that owns the claim marker."),
      sessionId: z.string().min(1).describe("Session id that owns the claim marker."),
      projectRoot: z.string().optional().describe("Project root. Defaults to AGENT_DESK_PROJECT_ROOT, INIT_CWD, or the MCP server working directory."),
      taskDir: z.string().optional().describe("Task directory relative to projectRoot. Default: task."),
    },
    outputSchema: {
      projectRoot: z.string(),
      taskDir: z.string(),
      filePath: z.string(),
      filename: z.string(),
      title: z.string(),
      taskCount: z.number(),
      openCount: z.number(),
      doneCount: z.number(),
      claimedCount: z.number(),
      items: z.array(taskItemSchema()),
      completed: z.array(taskItemSchema()),
      markdown: z.string(),
    },
  }, async (args) => {
    const result = await completeTaskMarkdownItems({
      ...args,
      projectRoot: args.projectRoot || options.projectRoot,
    });
    return toolResult(result, `Completed ${result.completed.length} item(s) in ${result.filePath}`);
  });

  server.registerTool("create_agentdesk_task", {
    title: "Create AgentDesk Task",
    description: "Create an AgentDesk control-plane task under <project>/.agent-desk/tasks by asking Codex CLI to generate task.md. If a similar task exists, the default response requires user confirmation before continuing an existing task or rebuilding a fresh one.",
    inputSchema: {
      title: z.string().min(1).optional().describe("Task title hint."),
      brief: z.string().min(1).describe("Task brief to turn into task.md."),
      similarTaskAction: z.enum(["confirm", "continue", "rebuild"]).optional().describe("What to do when a similar task exists. Default 'confirm' returns requiresConfirmation with candidates. Use 'continue' or 'rebuild' only after the user confirms."),
      ...contextInputSchema(),
    },
    outputSchema: taskCreateResultSchema(),
  }, async (args) => {
    const context = createMcpContext(args, options);
    const result = await createTask(context, {
      title: args.title,
      brief: args.brief,
      similarTaskAction: args.similarTaskAction,
    });
    return toolResult(result, taskCreateResultText(result));
  });

  server.registerTool("list_agentdesk_tasks", {
    title: "List AgentDesk Tasks",
    description: "List AgentDesk control-plane tasks from <project>/.agent-desk/tasks.",
    inputSchema: contextInputSchema(),
    outputSchema: {
      items: z.array(taskSummarySchema()),
    },
  }, async (args) => {
    const context = createMcpContext(args, options);
    const result = await listTasks(context);
    return toolResult(result, `Found ${result.items.length} AgentDesk task(s)`);
  });

  server.registerTool("read_agentdesk_task", {
    title: "Read AgentDesk Task",
    description: "Read an AgentDesk control-plane task, including generated task.md content and session summaries.",
    inputSchema: {
      taskId: z.string().min(1).describe("AgentDesk task id under <project>/.agent-desk/tasks."),
      ...contextInputSchema(),
    },
    outputSchema: taskDetailSchema(),
  }, async (args) => {
    const context = createMcpContext(args, options);
    const result = await getTask(context, args.taskId);
    return toolResult(result, result.markdown || `Read AgentDesk task: ${result.taskId}`);
  });

  server.registerTool("create_overall_task", {
    title: "Create Overall Task",
    description: "Create a day/week/month overall task backed by SQLite. This is separate from markdown checklist item claims.",
    inputSchema: {
      title: z.string().min(1).describe("Overall task title."),
      description: z.string().optional().describe("Optional overall task description."),
      taskType: z.string().optional().describe("Task type. Use coding when projectRoot is required."),
      periodType: z.enum(["day", "week", "month"]).optional().describe("Overall task period type."),
      periodKey: z.string().optional().describe("Canonical period key: YYYY-MM-DD, YYYY-Www, or YYYY-MM."),
      status: overallTaskStatusSchema().optional().describe("Overall task workflow status."),
      priority: z.union([z.string(), z.number()]).optional().describe("Priority label or numeric priority."),
      assignee: z.string().optional().describe("Optional assignee."),
      projectRoot: z.string().optional().describe("Coding project root. Defaults to the MCP context project root."),
      branch: z.string().optional().describe("Optional target branch."),
      dueAt: z.string().optional().describe("Optional due date/time."),
      ...contextInputSchema(),
    },
    outputSchema: overallTaskResultSchema(),
  }, async (args) => overallToolResult(async () => {
    const context = createMcpContext(args, options);
    const result = await createOverallTask(context, args);
    return {
      payload: result,
      text: `Created overall task ${result.task.title} (${result.task.overallTaskId})`,
    };
  }));

  server.registerTool("list_overall_tasks", {
    title: "List Overall Tasks",
    description: "List day/week/month overall tasks with UI-ready SQLite state.",
    inputSchema: {
      periodType: z.enum(["day", "week", "month"]).optional().describe("Optional period type filter."),
      periodKey: z.string().optional().describe("Optional canonical period key filter."),
      status: overallTaskStatusSchema().optional().describe("Optional overall task status filter."),
      assignee: z.string().optional().describe("Optional assignee filter."),
      q: z.string().optional().describe("Optional text search."),
      ...contextInputSchema(),
    },
    outputSchema: overallTaskListResultSchema(),
  }, async (args) => overallToolResult(async () => {
    const context = createMcpContext(args, options);
    const result = await listOverallTasks(context, args);
    return {
      payload: result,
      text: `Found ${result.items.length} overall task(s)`,
    };
  }));

  server.registerTool("read_overall_task", {
    title: "Read Overall Task",
    description: "Read one overall task, including claim, dispatch, session, and audit state.",
    inputSchema: {
      overallTaskId: z.string().min(1).describe("Overall task id."),
      ...contextInputSchema(),
    },
    outputSchema: overallTaskResultSchema(),
  }, async (args) => overallToolResult(async () => {
    const context = createMcpContext(args, options);
    const result = await getOverallTask(context, args.overallTaskId);
    return {
      payload: result,
      text: `Read overall task ${result.task.title} (${result.task.overallTaskId})`,
    };
  }));

  server.registerTool("update_overall_task", {
    title: "Update Overall Task",
    description: "Update overall task metadata or workflow status. This does not change markdown checklist item status.",
    inputSchema: {
      overallTaskId: z.string().min(1).describe("Overall task id."),
      title: z.string().optional(),
      description: z.string().optional(),
      taskType: z.string().optional(),
      periodType: z.enum(["day", "week", "month"]).optional(),
      periodKey: z.string().optional(),
      status: overallTaskStatusSchema().optional(),
      priority: z.union([z.string(), z.number()]).optional(),
      assignee: z.string().optional(),
      projectRoot: z.string().optional(),
      branch: z.string().optional(),
      dueAt: z.string().optional(),
      ...contextInputSchema(),
    },
    outputSchema: overallTaskResultSchema(),
  }, async (args) => overallToolResult(async () => {
    const context = createMcpContext(args, options);
    const result = await updateOverallTask(context, args.overallTaskId, args);
    return {
      payload: result,
      text: `Updated overall task ${result.task.title} (${result.task.overallTaskId})`,
    };
  }));

  server.registerTool("claim_overall_task", {
    title: "Claim Overall Task",
    description: "Claim ownership of an overall task. Checklist item claim tools remain separate.",
    inputSchema: {
      overallTaskId: z.string().min(1).describe("Overall task id."),
      assignee: z.string().min(1).describe("Assignee claiming the overall task."),
      sessionId: z.string().optional().describe("Optional session id."),
      note: z.string().optional(),
      force: z.boolean().optional(),
      ...contextInputSchema(),
    },
    outputSchema: overallTaskResultSchema(),
  }, async (args) => overallToolResult(async () => {
    const context = createMcpContext(args, options);
    const result = await claimOverallTask(context, args.overallTaskId, args);
    return {
      payload: result,
      text: `Claimed overall task ${result.task.title} for ${result.task.assignee}`,
    };
  }));

  server.registerTool("dispatch_overall_task", {
    title: "Dispatch Overall Task",
    description: "Record dispatch/session state for an overall task without modifying markdown checklist item status.",
    inputSchema: {
      overallTaskId: z.string().min(1).describe("Overall task id."),
      assignee: z.string().optional().describe("Optional dispatch assignee."),
      sessionId: z.string().min(1).describe("Dispatch/session id."),
      branch: z.string().optional().describe("Optional target branch."),
      target: z.string().optional().describe("Optional dispatch target."),
      agentdeskTaskId: z.string().optional().describe("Optional AgentDesk control-plane task id."),
      note: z.string().optional(),
      force: z.boolean().optional(),
      ...contextInputSchema(),
    },
    outputSchema: overallTaskResultSchema(),
  }, async (args) => overallToolResult(async () => {
    const context = createMcpContext(args, options);
    const result = await dispatchOverallTask(context, args.overallTaskId, args);
    return {
      payload: result,
      text: `Dispatched overall task ${result.task.title} (${result.task.overallTaskId})`,
    };
  }));

  server.registerTool("start_subagent_session", {
    title: "Start Subagent Session",
    description: "Start an AgentDesk subagent session. The main agent should use auto/current-branch when worktree isolation is unnecessary, and worktree only for parallel work that needs branch isolation. codex-cli sessions are launched by AgentDesk and block until completion by default. codex-app sessions create a tracked launch plan for the Codex App host to spawn directly.",
    inputSchema: {
      taskId: z.string().min(1).describe("Ready AgentDesk task id under <project>/.agent-desk/tasks."),
      parallelism: z.number().optional().describe("Maximum concurrent subagents. Default 6, max 24."),
      model: z.string().optional().describe("Codex model for subagents. Default: gpt-5.5."),
      reasoning: z.enum(["low", "medium", "high", "xhigh"]).optional().describe("Codex reasoning effort. Default: xhigh."),
      executionMode: z.enum(["auto", "worktree", "current-branch"]).optional().describe("Execution mode. Default auto lets the main agent avoid worktrees for simple or non-conflicting tasks. codex-app uses current-branch."),
      subagentLauncher: z.enum(["codex-cli", "codex-app"]).optional().describe("Subagent launcher. Default: codex-cli."),
      launchPrompt: z.string().optional().describe("Optional extra launch context included in each subagent prompt."),
      waitForCompletion: z.boolean().optional().describe("For codex-cli sessions, wait for all subagents to finish before returning. Default: true."),
      allowDuplicateSession: z.boolean().optional().describe("Override the active-session guard and allow another session for the same task. Default: false."),
      force: z.boolean().optional().describe("Alias for allowDuplicateSession."),
      ...contextInputSchema(),
    },
    outputSchema: sessionStartSchema(),
  }, async (args) => {
    const context = createMcpContext(args, options);
    const subagentLauncher = args.subagentLauncher || "codex-cli";
    const waitForCompletion = subagentLauncher === "codex-cli"
      ? args.waitForCompletion ?? true
      : false;
    const result = await createSession(context, args.taskId, {
      parallelism: args.parallelism,
      model: args.model,
      reasoning: args.reasoning,
      executionMode: args.executionMode || (subagentLauncher === "codex-app" ? "current-branch" : undefined),
      subagentLauncher,
      launchPrompt: args.launchPrompt,
      waitForCompletion,
      allowDuplicateSession: args.allowDuplicateSession || args.force,
    });
    const appLaunchPlan = subagentLauncher === "codex-app"
      ? await getCodexAppLaunchPlan(context, result.sessionId)
      : emptyAppLaunchPlan(result.sessionId, result.parallelism);
    const payload = {
      ...result,
      requiresHostLaunch: appLaunchPlan.requiresHostLaunch,
      waitedForCompletion: waitForCompletion,
      appLaunchPlan,
    };
    const text = appLaunchPlan.requiresHostLaunch
      ? `Prepared ${appLaunchPlan.subagents.length} Codex App subagent prompt(s) for session ${result.name || result.sessionId} (${result.sessionId})`
      : waitForCompletion
        ? `Completed AgentDesk Codex CLI session ${result.name || result.sessionId} (${result.sessionId}) with status ${result.status}`
        : `Started AgentDesk Codex CLI session: ${result.name || result.sessionId} (${result.sessionId})`;
    return toolResult(payload, text);
  });

  server.registerTool("list_subagent_sessions", {
    title: "List Subagent Sessions",
    description: "List AgentDesk subagent sessions from <project>/.agent-desk/sessions.",
    inputSchema: {
      taskId: z.string().optional().describe("Optional task id filter."),
      ...contextInputSchema(),
    },
    outputSchema: {
      items: z.array(sessionSummarySchema()),
    },
  }, async (args) => {
    const context = createMcpContext(args, options);
    const result = await listSessions(context, { taskId: args.taskId });
    return toolResult(result, `Found ${result.items.length} AgentDesk session(s)`);
  });

  server.registerTool("read_subagent_session", {
    title: "Read Subagent Session",
    description: "Read an AgentDesk subagent session, including status, agents, docs, and Codex App launch plan when applicable.",
    inputSchema: {
      sessionId: z.string().min(1).describe("AgentDesk session id under <project>/.agent-desk/sessions."),
      ...contextInputSchema(),
    },
    outputSchema: sessionDetailSchema(),
  }, async (args) => {
    const context = createMcpContext(args, options);
    const result = await getSession(context, args.sessionId);
    const appLaunchPlan = result.subagentLauncher === "codex-app"
      ? await getCodexAppLaunchPlan(context, result.sessionId)
      : emptyAppLaunchPlan(result.sessionId, result.parallelism);
    const payload = {
      ...result,
      requiresHostLaunch: appLaunchPlan.requiresHostLaunch,
      appLaunchPlan,
    };
    return toolResult(payload, result.docContent || `Read AgentDesk session: ${result.sessionId}`);
  });

  return server;
}

export async function startAgentDeskMcpServer(options = {}) {
  const server = createAgentDeskMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

function toolResult(structuredContent, text) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

async function overallToolResult(callback) {
  try {
    const result = await callback();
    return toolResult(result.payload, result.text);
  } catch (error) {
    const payload = {
      ok: false,
      error: serializeAgentDeskError(error),
    };
    return toolResult(payload, payload.error.message);
  }
}

function taskItemSchema() {
  return z.object({
    index: z.number(),
    line: z.number(),
    title: z.string(),
    checked: z.boolean(),
    claimedBy: z.string(),
    claimedAt: z.string(),
    claimSessionId: z.string(),
    claimNote: z.string(),
    claimLine: z.number(),
  });
}

function createMcpContext(args = {}, options = {}) {
  return createContext({
    projectRoot: args.projectRoot || options.projectRoot,
    deskRoot: args.deskRoot,
    worktreesRoot: args.worktreesRoot,
    configPath: args.configPath,
    codexCli: args.codexCli,
  });
}

function contextInputSchema() {
  return {
    projectRoot: z.string().optional().describe("Project root. Defaults to AGENT_DESK_PROJECT_ROOT, INIT_CWD, git root, or the MCP server working directory."),
    deskRoot: z.string().optional().describe("Override <project>/.agent-desk."),
    worktreesRoot: z.string().optional().describe("Override the persistent git worktrees root."),
    configPath: z.string().optional().describe("Override the AgentDesk TOML config path."),
    codexCli: z.string().optional().describe("Override the Codex CLI executable path."),
  };
}

function taskSummarySchema() {
  return z.object({
    taskId: z.string(),
    name: z.string(),
    title: z.string(),
    status: z.string(),
    subtaskCount: z.number(),
    updatedAt: z.string(),
  }).passthrough();
}

function taskCreateResultSchema() {
  return z.object({
    requiresConfirmation: z.boolean().optional(),
    taskId: z.string().optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    status: z.string().optional(),
    subtaskCount: z.number().optional(),
    requestedTitle: z.string().optional(),
    requestedBrief: z.string().optional(),
    similarTaskAction: z.string().optional(),
    reusedExistingTask: z.boolean().optional(),
    similarTasks: z.array(taskSummarySchema().extend({
      similarityScore: z.number(),
      similarityReason: z.string(),
    }).passthrough()).optional(),
    message: z.string().optional(),
    confirmationChoices: z.array(z.object({
      action: z.string(),
      description: z.string(),
    })).optional(),
  }).passthrough();
}

function taskCreateResultText(result) {
  if (result.requiresConfirmation) {
    const matches = (result.similarTasks || [])
      .map((task) => `- ${task.name || task.title || task.taskId} (${task.taskId}, ${task.status}, score ${task.similarityScore})`)
      .join("\n");
    return [
      "Similar AgentDesk task(s) found. Ask the user whether to continue an existing task or rebuild a fresh task.",
      matches,
      "Use similarTaskAction='continue' to reuse the best match, or similarTaskAction='rebuild' to create a fresh task after confirmation.",
    ].filter(Boolean).join("\n");
  }
  if (result.reusedExistingTask) {
    return `Continuing existing AgentDesk task: ${result.name || result.title || result.taskId} (${result.taskId})`;
  }
  return `Started AgentDesk task generation: ${result.name || result.title || result.taskId} (${result.taskId})`;
}

function taskDetailSchema() {
  return taskSummarySchema().extend({
    markdown: z.string(),
    memory: z.string(),
    memoryPath: z.string(),
    sessions: z.array(sessionSummarySchema()),
  }).passthrough();
}

function sessionSummarySchema() {
  return z.object({
    sessionId: z.string(),
    name: z.string(),
    taskId: z.string(),
    status: z.string(),
    parallelism: z.number(),
    executionMode: z.string(),
    subagentLauncher: z.string(),
  }).passthrough();
}

function sessionDetailSchema() {
  return sessionSummarySchema().extend({
    agents: z.array(agentSchema()),
    docContent: z.string(),
    requiresHostLaunch: z.boolean().optional(),
    appLaunchPlan: appLaunchPlanSchema().optional(),
  }).passthrough();
}

function sessionStartSchema() {
  return sessionSummarySchema().extend({
    requiresHostLaunch: z.boolean(),
    waitedForCompletion: z.boolean().optional(),
    appLaunchPlan: appLaunchPlanSchema(),
  }).passthrough();
}

function agentSchema() {
  return z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
  }).passthrough();
}

function appLaunchPlanSchema() {
  return z.object({
    sessionId: z.string(),
    requiresHostLaunch: z.boolean(),
    launchTool: z.string(),
    parallelism: z.number(),
    subagents: z.array(z.object({
      agentId: z.string(),
      title: z.string(),
      status: z.string(),
      taskSnapshotPath: z.string(),
      memorySnapshotPath: z.string(),
      promptPath: z.string(),
      prompt: z.string(),
    })),
  });
}

function overallTaskStatusSchema() {
  return z.enum(["draft", "backlog", "ready", "claimed", "dispatched", "running", "blocked", "done", "succeeded", "failed", "canceled"]);
}

function overallTaskResultSchema() {
  return z.object({
    ok: z.boolean().optional(),
    task: overallTaskSchema().optional(),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.object({}).passthrough().optional(),
    }).optional(),
  }).passthrough();
}

function overallTaskListResultSchema() {
  return z.object({
    ok: z.boolean().optional(),
    period: z.string().optional(),
    periodKey: z.string().optional(),
    items: z.array(overallTaskSchema()).optional(),
    summary: z.object({}).passthrough().optional(),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.object({}).passthrough().optional(),
    }).optional(),
  }).passthrough();
}

function overallTaskSchema() {
  return z.object({
    id: z.string(),
    overallTaskId: z.string(),
    taskId: z.string(),
    title: z.string(),
    description: z.string(),
    taskType: z.string(),
    periodType: z.string(),
    periodKey: z.string(),
    status: z.string(),
    priority: z.number(),
    assignee: z.string(),
    projectRoot: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).passthrough();
}

function emptyAppLaunchPlan(sessionId, parallelism) {
  return {
    sessionId,
    requiresHostLaunch: false,
    launchTool: "",
    parallelism,
    subagents: [],
  };
}
