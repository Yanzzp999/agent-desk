import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import {
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
      filename: z.string().min(1).describe("Task markdown filename inside task/."),
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
      markdown: z.string(),
    },
  }, async (args) => {
    const result = await readTaskMarkdownFile({
      ...args,
      projectRoot: args.projectRoot || options.projectRoot,
    });
    return toolResult(result, result.markdown);
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
