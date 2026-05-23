import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  CODEX_REASONING_EFFORT_OPTIONS,
  discoverCodexModels,
  getCodexFastSupportMetadata,
  getCodexReasoningEffortOptions,
  parseCodexModelsOutput,
  resolveCodexCliPath,
} from "../src/lib/codex-cli.mjs";

test("resolves Codex CLI from explicit path, env, PATH, then command fallback", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-cli-path-"));
  const binDir = path.join(tempRoot, "bin");
  const codexPath = path.join(binDir, "codex");
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(codexPath, "#!/bin/sh\n", { mode: 0o755 });
  await fs.chmod(codexPath, 0o755);

  assert.equal(resolveCodexCliPath({ explicitPath: "tools/codex", pathValue: "" }), path.resolve("tools/codex"));
  assert.equal(resolveCodexCliPath({ explicitPath: "codex", pathValue: "" }), "codex");
  assert.equal(resolveCodexCliPath({ env: { CODEX_CLI: codexPath, PATH: "" } }), codexPath);
  assert.equal(resolveCodexCliPath({ env: { PATH: binDir } }), codexPath);
  assert.equal(resolveCodexCliPath({ env: { PATH: "" } }), "codex");
});

test("parses Codex debug models JSON into small normalized model capabilities", () => {
  const output = JSON.stringify({
    models: [
      {
        slug: "gpt-5.5",
        display_name: "GPT-5.5",
        description: "Frontier model",
        default_reasoning_level: "xhigh",
        supported_reasoning_levels: [
          { effort: "low", description: "Fast responses" },
          { effort: "xhigh", description: "Extra high reasoning" },
        ],
        additional_speed_tiers: ["fast"],
        service_tiers: [{ id: "priority", name: "Fast", description: "1.5x speed" }],
        supported_in_api: true,
        priority: 0,
        base_instructions: "large field should not leak into normalized metadata",
      },
    ],
  });

  const models = parseCodexModelsOutput(output);
  assert.equal(models.length, 1);
  assert.equal(models[0].slug, "gpt-5.5");
  assert.equal(models[0].displayName, "GPT-5.5");
  assert.equal(models[0].defaultReasoningEffort, "xhigh");
  assert.deepEqual(models[0].reasoningEfforts.map((entry) => entry.value), ["low", "xhigh"]);
  assert.equal(models[0].fast.supported, true);
  assert.equal(models[0].fast.source, "service_tiers");
  assert.equal(models[0].fast.tier, "priority");
  assert.equal(models[0].fast.configKey, "service_tier");
  assert.equal("base_instructions" in models[0], false);
});

test("parses text model lists and extracts fast support", () => {
  const models = parseCodexModelsOutput(`
Available models
- gpt-5.1-codex GPT-5.1 Codex (fast)
* o4-mini Small reasoning model
workspace-write is not a model
`);

  assert.deepEqual(models.map((model) => model.slug), ["gpt-5.1-codex", "o4-mini"]);
  assert.equal(models[0].fast.supported, true);
  assert.equal(models[1].fast.supported, false);
});

test("provides reasoning options and filters them by selected model", () => {
  assert.deepEqual(CODEX_REASONING_EFFORT_OPTIONS.map((option) => option.value), ["", "low", "medium", "high", "xhigh"]);

  const options = getCodexReasoningEffortOptions({
    reasoningEfforts: [{ value: "low" }, { value: "high" }],
  });
  assert.deepEqual(options.map((option) => option.value), ["", "low", "high"]);
});

test("discovers models from injected CLI runner and falls back when discovery fails", async () => {
  const discovered = await discoverCodexModels({
    codexCliPath: "/usr/local/bin/codex",
    runCommand: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        models: [
          {
            slug: "gpt-5.5",
            service_tiers: [{ id: "priority", name: "Fast" }],
          },
        ],
      }),
      stderr: "",
    }),
  });

  assert.equal(discovered.source, "codex-cli");
  assert.equal(discovered.models[0].slug, "gpt-5.5");
  assert.equal(discovered.models[0].fast.tier, "priority");
  assert.equal(discovered.fast.supported, true);
  assert.equal(discovered.fast.tier, "priority");
  assert.equal(discovered.fast.configKey, "service_tier");
  assert.deepEqual(getCodexFastSupportMetadata(discovered.models).supportedModels, ["gpt-5.5"]);
  assert.equal(getCodexFastSupportMetadata(discovered.models).tier, "priority");

  const fallback = await discoverCodexModels({
    codexCliPath: "/missing/codex",
    commands: [["debug", "models"]],
    runCommand: async () => ({ exitCode: 1, stdout: "", stderr: "not found" }),
  });

  assert.equal(fallback.source, "fallback");
  assert.equal(fallback.models.length > 0, true);
  assert.equal(fallback.errors.length, 1);
});
