#!/usr/bin/env node
import process from "node:process";
import { startAgentDeskMcpServer } from "../src/lib/mcp-server.mjs";

const args = parseArgs(process.argv.slice(2));

startAgentDeskMcpServer({
  projectRoot: args.project,
}).catch((error) => {
  console.error(`agent-desk-mcp: ${error.message || error}`);
  process.exit(1);
});

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}
