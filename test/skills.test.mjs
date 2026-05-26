import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");

test("npm package includes bundled Codex skills", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.ok(pkg.files.includes("skills/"));
  assert.ok(pkg.files.includes("scripts/check-github-version.sh"));
  assert.ok(pkg.files.includes("scripts/sync-codex-skills.sh"));

  for (const skillName of [
    "claim-agentdesk-task",
    "codexapp-direct-subagents",
    "generate-agentdesk-task",
    "review-agentdesk-task",
    "run-agentdesk-subagents",
  ]) {
    const skillPath = path.join(REPO_ROOT, "skills", skillName, "SKILL.md");
    const text = await fs.readFile(skillPath, "utf8");
    assert.match(text, new RegExp(`name: ${skillName}`));
    assert.match(text, /Explicit Invocation Only/);
    assert.match(text, /The user must explicitly specify this skill by writing/);
    assert.match(text, /Never infer this skill from task content/);
    assert.doesNotMatch(text, /otherwise unambiguously/);
  }
});

test("sync-codex-skills copies bundled skills to CODEX_HOME", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-codex-home-"));
  const stalePath = path.join(codexHome, "skills", "generate-agentdesk-task", "stale.txt");
  await fs.mkdir(path.dirname(stalePath), { recursive: true });
  await fs.writeFile(stalePath, "stale\n");

  const result = await run("sh", [path.join(REPO_ROOT, "scripts", "sync-codex-skills.sh")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      AGENT_DESK_SKIP_UPDATE_CHECK: "1",
    },
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Synced 5 Codex skill\(s\)/);

  for (const skillName of [
    "claim-agentdesk-task",
    "codexapp-direct-subagents",
    "generate-agentdesk-task",
    "review-agentdesk-task",
    "run-agentdesk-subagents",
  ]) {
    const source = await fs.readFile(path.join(REPO_ROOT, "skills", skillName, "SKILL.md"), "utf8");
    const installed = await fs.readFile(path.join(codexHome, "skills", skillName, "SKILL.md"), "utf8");
    const sourceRoot = await fs.readFile(
      path.join(codexHome, "skills", skillName, ".agentdesk-source-root"),
      "utf8",
    );
    assert.equal(installed, source);
    assert.equal(sourceRoot.trim(), REPO_ROOT);
  }

  await assert.rejects(async () => {
    await fs.access(stalePath);
  }, { code: "ENOENT" });
});

test("claim-agentdesk-task skill documents atomic claim and completion workflow", async () => {
  const skill = await fs.readFile(
    path.join(REPO_ROOT, "skills", "claim-agentdesk-task", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /claim_next_task_item/);
  assert.match(skill, /complete_task_items/);
  assert.match(skill, /assignee/);
  assert.match(skill, /sessionId/);
  assert.match(skill, /implement only that item/);
  assert.match(skill, /Never start implementation before `claim_next_task_item` succeeds/);
});

test("generate-agentdesk-task skill requires task brief completeness review", async () => {
  const skill = await fs.readFile(
    path.join(REPO_ROOT, "skills", "generate-agentdesk-task", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /Task Brief Completeness Review/);
  assert.match(skill, /complete enough to produce an executable `task\.md`/);
  assert.match(skill, /ask the user a concise follow-up question/);
  assert.match(skill, /before calling `create_agentdesk_task`/);
});

test("generate-agentdesk-task skill documents GitHub update check", async () => {
  const skill = await fs.readFile(
    path.join(REPO_ROOT, "skills", "generate-agentdesk-task", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /AgentDesk GitHub Version Check/);
  assert.match(skill, /check-github-version\.sh/);
  assert.match(skill, /AGENT_DESK_SKIP_UPDATE_CHECK=1/);
});

test("check-github-version warns when the local checkout differs from GitHub", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-version-check-"));
  const remote = path.join(tempRoot, "remote.git");
  const local = path.join(tempRoot, "local");
  const updater = path.join(tempRoot, "updater");

  await runOk("git", ["init", "--bare", remote]);
  await runOk("git", ["init", "-b", "agentdesk/next", local]);
  await runOk("git", ["-C", local, "config", "user.email", "agentdesk@example.com"]);
  await runOk("git", ["-C", local, "config", "user.name", "AgentDesk Test"]);
  await fs.writeFile(path.join(local, "README.md"), "initial\n");
  await runOk("git", ["-C", local, "add", "README.md"]);
  await runOk("git", ["-C", local, "commit", "-m", "initial"]);
  await runOk("git", ["-C", local, "remote", "add", "origin", remote]);
  await runOk("git", ["-C", local, "push", "origin", "agentdesk/next"]);

  await runOk("git", ["clone", remote, updater]);
  await runOk("git", ["-C", updater, "switch", "agentdesk/next"]);
  await runOk("git", ["-C", updater, "config", "user.email", "agentdesk@example.com"]);
  await runOk("git", ["-C", updater, "config", "user.name", "AgentDesk Test"]);
  await fs.writeFile(path.join(updater, "README.md"), "updated\n");
  await runOk("git", ["-C", updater, "commit", "-am", "update"]);
  await runOk("git", ["-C", updater, "push", "origin", "agentdesk/next"]);

  const result = await run("sh", [path.join(REPO_ROOT, "scripts", "check-github-version.sh"), "--repo", local], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      AGENT_DESK_GITHUB_REPO_URL: remote,
    },
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stderr, /AgentDesk update available/);
  assert.match(result.stderr, /git -C .* pull --ff-only/);
});

test("check-github-version stays quiet when the local checkout is ahead of GitHub", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-version-check-ahead-"));
  const remote = path.join(tempRoot, "remote.git");
  const local = path.join(tempRoot, "local");

  await runOk("git", ["init", "--bare", remote]);
  await runOk("git", ["init", "-b", "agentdesk/next", local]);
  await runOk("git", ["-C", local, "config", "user.email", "agentdesk@example.com"]);
  await runOk("git", ["-C", local, "config", "user.name", "AgentDesk Test"]);
  await fs.writeFile(path.join(local, "README.md"), "initial\n");
  await runOk("git", ["-C", local, "add", "README.md"]);
  await runOk("git", ["-C", local, "commit", "-m", "initial"]);
  await runOk("git", ["-C", local, "remote", "add", "origin", remote]);
  await runOk("git", ["-C", local, "push", "origin", "agentdesk/next"]);

  await fs.writeFile(path.join(local, "README.md"), "local ahead\n");
  await runOk("git", ["-C", local, "commit", "-am", "local ahead"]);

  const result = await run("sh", [path.join(REPO_ROOT, "scripts", "check-github-version.sh"), "--repo", local], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      AGENT_DESK_GITHUB_REPO_URL: remote,
    },
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /AgentDesk update available/);
});

test("review-agentdesk-task skill documents read-only pre-implementation task review", async () => {
  const skill = await fs.readFile(
    path.join(REPO_ROOT, "skills", "review-agentdesk-task", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /read-only pre-implementation review/);
  assert.match(skill, /aligned with the user's intent/);
  assert.match(skill, /Never call `claim_next_task_item`/);
  assert.match(skill, /Never edit task files/);
  assert.match(skill, /Needs clarification/);
  assert.match(skill, /Blocked/);
  assert.match(skill, /Suggested task edits/);
});

test("run-agentdesk-subagents skill documents bounded concurrency and app handoff", async () => {
  const skill = await fs.readFile(
    path.join(REPO_ROOT, "skills", "run-agentdesk-subagents", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /maximum concurrency limit/);
  assert.match(skill, /review the task's complexity/);
  assert.match(skill, /concurrent-edit conflicts/);
  assert.match(skill, /Notify the user of the chosen recommendation/);
  assert.match(skill, /user-selected value/);
  assert.match(skill, /Never launch more subagents at once than `parallelism`/);
  assert.match(skill, /only the Codex App host can actually start them/);
});

test("codexapp-direct-subagents skill bypasses AgentDesk tasks by default", async () => {
  const skill = await fs.readFile(
    path.join(REPO_ROOT, "skills", "codexapp-direct-subagents", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /without creating a task/);
  assert.match(skill, /Do not create `task\.md`/);
  assert.match(skill, /call `create_agentdesk_task`/);
  assert.match(skill, /call `start_subagent_session`/);
  assert.match(skill, /model: "gpt-5\.5"/);
  assert.match(skill, /reasoning_effort: "xhigh"/);
  assert.match(skill, /Launch at most `6` subagents/);
});

test("project docs describe model-reviewed concurrency recommendations", async () => {
  const readme = await fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8");
  const zhReadme = await fs.readFile(path.join(REPO_ROOT, "docs", "README.zh-CN.md"), "utf8");
  const generateSkill = await fs.readFile(
    path.join(REPO_ROOT, "skills", "generate-agentdesk-task", "SKILL.md"),
    "utf8",
  );

  assert.match(readme, /review task complexity and concurrent-edit conflict risk/);
  assert.match(readme, /recommended per-batch subagent count/);
  assert.match(readme, /user can still choose a different concurrency value/);
  assert.match(readme, /claim_next_task_item/);
  assert.match(readme, /agent -> sessionId/);
  assert.match(zhReadme, /评审 task 复杂度和并发编辑冲突风险/);
  assert.match(zhReadme, /推荐的每批 subagent 数量/);
  assert.match(zhReadme, /用户仍可在配置上限内自行选择不同的并发量/);
  assert.match(zhReadme, /claim_next_task_item/);
  assert.match(zhReadme, /agent -> sessionId/);
  assert.match(generateSkill, /review task complexity and concurrency-conflict risk/);
  assert.match(generateSkill, /recommended per-batch subagent count/);
  assert.match(generateSkill, /later user-selected concurrency/);
});

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function runOk(command, args, options = {}) {
  const result = await run(command, args, options);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return result;
}
