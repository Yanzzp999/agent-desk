#!/usr/bin/env node

import process from "node:process";
import {
  createContext,
  runSessionJob,
  runTaskGenerationJob,
} from "../lib/control-plane.mjs";

const args = parseArgs(process.argv.slice(2));
const context = createContext({
  projectRoot: args.project,
  deskRoot: args["desk-root"],
  worktreesRoot: args["worktrees-root"],
  configPath: args.config,
  codexCli: args["codex-cli"],
});

try {
  if (args.job === "generate-task") {
    await runTaskGenerationJob(context, args.task);
    process.exit(0);
  }
  if (args.job === "run-session") {
    await runSessionJob(context, args.session);
    process.exit(0);
  }
  throw new Error(`unsupported job: ${args.job || ""}`);
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}

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
