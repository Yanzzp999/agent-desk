import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import {
  claimTaskMarkdownItems,
  createTaskMarkdownFile,
  listTaskMarkdownFiles,
  readTaskMarkdownFile,
} from "./task-files.mjs";

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

function taskItemSchema() {
  return z.object({
    index: z.number(),
    line: z.number(),
    title: z.string(),
    checked: z.boolean(),
    claimedBy: z.string(),
    claimedAt: z.string(),
    claimNote: z.string(),
    claimLine: z.number(),
  });
}
