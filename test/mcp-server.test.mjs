import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");
const MCP_BIN = path.join(REPO_ROOT, "bin", "agent-desk-mcp.mjs");

test("MCP server creates task markdown in the launched project", async () => {
  const projectRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-mcp-")));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    cwd: projectRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-desk-mcp-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["create_task", "list_tasks", "read_task"],
    );

    const created = await client.callTool({
      name: "create_task",
      arguments: {
        title: "MCP task generation",
        brief: "Create a portable task file.",
        tasks: ["Expose MCP entrypoint", "Write task markdown"],
      },
    });

    assert.equal(created.structuredContent.filename, "mcp-task-generation.task.md");
    assert.equal(created.structuredContent.taskDir, path.join(projectRoot, "task"));
    assert.match(created.structuredContent.markdown, /^- \[ \] Expose MCP entrypoint/m);

    const fileText = await fs.readFile(
      path.join(projectRoot, "task", "mcp-task-generation.task.md"),
      "utf8",
    );
    assert.equal(fileText, created.structuredContent.markdown);
  } finally {
    await client.close();
  }
});
