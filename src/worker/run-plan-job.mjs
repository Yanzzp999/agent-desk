#!/usr/bin/env node
import process from "node:process";
import { createContext, runPlanJob } from "../lib/control-plane.mjs";

const args = parseArgs(process.argv.slice(2));
const context = createContext({
  projectRoot: args.project,
  stateRoot: args["state-dir"],
  uiStateRoot: args["ui-state-dir"],
});

runPlanJob(context, args.job).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    result[key] = argv[index + 1];
    index += 1;
  }
  return result;
}
