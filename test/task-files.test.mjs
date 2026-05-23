import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  claimTaskMarkdownItems,
  claimNextTaskMarkdownItem,
  completeTaskMarkdownItems,
  createTaskMarkdownFile,
  listTaskMarkdownFiles,
  readTaskMarkdownFile,
  renderTaskMarkdown,
} from "../src/lib/task-files.mjs";

test("creates a named task markdown file in project task directory", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-files-"));
  const result = await createTaskMarkdownFile({
    projectRoot,
    title: "Checkout flow",
    brief: "Implement checkout end to end.",
    tasks: [
      "Add payment state model",
      "- [ ] Wire confirmation screen",
      "Add payment state model",
    ],
  });

  assert.equal(result.filename, "checkout-flow.task.md");
  assert.equal(result.filePath, path.join(projectRoot, "task", "checkout-flow.task.md"));
  assert.deepEqual(result.tasks, ["Add payment state model", "Wire confirmation screen"]);

  const markdown = await fs.readFile(result.filePath, "utf8");
  assert.match(markdown, /^# Checkout flow/m);
  assert.match(markdown, /^- \[ \] Add payment state model/m);
  assert.match(markdown, /^- \[ \] Wire confirmation screen/m);

  const listed = await listTaskMarkdownFiles({ projectRoot });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].taskCount, 2);
  assert.equal(listed.items[0].claimedCount, 0);
});

test("isolates markdown task files by projectRoot and taskDir", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-files-scope-"));
  const projectA = path.join(root, "project-a");
  const projectB = path.join(root, "project-b");
  await fs.mkdir(projectA, { recursive: true });
  await fs.mkdir(projectB, { recursive: true });

  const scoped = await createTaskMarkdownFile({
    projectRoot: projectA,
    taskDir: "plans/sprint",
    title: "Scoped work",
    tasks: ["- [x] Normalize API", "2. Read back task"],
  });
  await createTaskMarkdownFile({
    projectRoot: projectB,
    title: "Scoped work",
    tasks: ["Write unrelated task"],
  });

  assert.equal(scoped.projectRoot, projectA);
  assert.equal(scoped.taskDir, path.join(projectA, "plans", "sprint"));
  assert.equal(scoped.filePath, path.join(projectA, "plans", "sprint", "scoped-work.task.md"));
  assert.deepEqual(scoped.tasks, ["Normalize API", "Read back task"]);
  assert.match(scoped.markdown, /^- \[ \] Normalize API/m);
  assert.match(scoped.markdown, /^- \[ \] Read back task/m);

  const defaultListA = await listTaskMarkdownFiles({ projectRoot: projectA });
  assert.deepEqual(defaultListA.items, []);

  const scopedListA = await listTaskMarkdownFiles({ projectRoot: projectA, taskDir: "plans/sprint" });
  assert.equal(scopedListA.taskDir, path.join(projectA, "plans", "sprint"));
  assert.deepEqual(scopedListA.items.map((item) => item.filename), ["scoped-work.task.md"]);
  assert.equal(scopedListA.items[0].taskCount, 2);

  const readScoped = await readTaskMarkdownFile({
    projectRoot: projectA,
    taskDir: "plans/sprint",
    taskName: "Scoped work",
  });
  assert.equal(readScoped.filePath, scoped.filePath);
  assert.deepEqual(readScoped.items.map((item) => item.title), ["Normalize API", "Read back task"]);

  const defaultListB = await listTaskMarkdownFiles({ projectRoot: projectB });
  assert.deepEqual(defaultListB.items.map((item) => item.filePath), [
    path.join(projectB, "task", "scoped-work.task.md"),
  ]);
});

test("rejects taskDir values outside projectRoot", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-files-scope-"));

  await assert.rejects(
    () => createTaskMarkdownFile({
      projectRoot,
      taskDir: "../outside",
      title: "Escape attempt",
      tasks: ["Do not write outside the project"],
    }),
    /taskDir must stay inside projectRoot/,
  );

  await assert.rejects(
    () => listTaskMarkdownFiles({
      projectRoot,
      taskDir: path.join(os.tmpdir(), "outside-agent-desk-task-dir"),
    }),
    /taskDir must be relative to projectRoot/,
  );

  await assert.rejects(
    () => readTaskMarkdownFile({
      projectRoot,
      taskDir: "../../outside",
      taskName: "missing.task.md",
    }),
    /taskDir must stay inside projectRoot/,
  );
});

test("creates unique duplicate filenames unless overwrite is requested", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-files-"));

  const first = await createTaskMarkdownFile({
    projectRoot,
    title: "Original duplicate",
    tasks: ["Keep first file"],
    filename: "duplicate.md",
  });
  const second = await createTaskMarkdownFile({
    projectRoot,
    title: "Second duplicate",
    tasks: ["Keep second file"],
    filename: "duplicate.md",
  });
  const replacement = await createTaskMarkdownFile({
    projectRoot,
    title: "Replacement duplicate",
    tasks: ["Replace first file"],
    filename: "duplicate.md",
    overwrite: true,
  });

  assert.equal(first.filename, "duplicate.md");
  assert.equal(second.filename, "duplicate-2.md");
  assert.equal(replacement.filename, "duplicate.md");

  const listed = await listTaskMarkdownFiles({ projectRoot });
  assert.deepEqual(listed.items.map((item) => item.filename), ["duplicate-2.md", "duplicate.md"]);
  assert.deepEqual(listed.items.map((item) => item.title), ["Second duplicate", "Replacement duplicate"]);

  const readReplacement = await readTaskMarkdownFile({ projectRoot, filename: "duplicate.md" });
  assert.equal(readReplacement.title, "Replacement duplicate");
  assert.deepEqual(readReplacement.items.map((item) => item.title), ["Replace first file"]);
});

test("creates unique task markdown files under concurrent same-name writes", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-files-"));
  const [first, second] = await Promise.all([
    createTaskMarkdownFile({
      projectRoot,
      title: "Race A",
      tasks: ["Write first file"],
      filename: "race.task.md",
    }),
    createTaskMarkdownFile({
      projectRoot,
      title: "Race B",
      tasks: ["Write second file"],
      filename: "race.task.md",
    }),
  ]);

  assert.equal(new Set([first.filename, second.filename]).size, 2);
  assert.deepEqual(
    [first.filename, second.filename].sort(),
    ["race.task-2.md", "race.task.md"],
  );

  const files = await fs.readdir(path.join(projectRoot, "task"));
  assert.deepEqual(files.sort(), ["race.task-2.md", "race.task.md"]);

  const markdownByTitle = new Map();
  for (const file of files) {
    const markdown = await fs.readFile(path.join(projectRoot, "task", file), "utf8");
    markdownByTitle.set(markdown.match(/^#\s+(.+)$/m)?.[1], markdown);
  }
  assert.match(markdownByTitle.get("Race A"), /^- \[ \] Write first file/m);
  assert.match(markdownByTitle.get("Race B"), /^- \[ \] Write second file/m);
});

test("renders fallback checklist item when tasks are omitted", () => {
  const markdown = renderTaskMarkdown({ title: "Small task" });
  assert.match(markdown, /^## Tasks/m);
  assert.match(markdown, /^- \[ \] Define and implement the requested change/m);
});

test("claims checklist items by task name and preserves visible ownership markers", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-files-"));
  await createTaskMarkdownFile({
    projectRoot,
    title: "Manual claim flow",
    tasks: [
      "Implement the API",
      "Wire the UI",
      "Add tests",
    ],
  });

  const claimed = await claimTaskMarkdownItems({
    projectRoot,
    taskName: "Manual claim flow",
    items: [1, "UI"],
    assignee: "agent-alpha",
    sessionId: "session-alpha",
    claimedAt: "2026-05-14T00:00:00.000Z",
  });

  assert.equal(claimed.filename, "manual-claim-flow.task.md");
  assert.equal(claimed.claimedCount, 2);
  assert.deepEqual(claimed.claimed.map((item) => item.index), [1, 2]);
  assert.match(claimed.markdown, /^  - AgentDesk claim: `agent-alpha` at 2026-05-14T00:00:00.000Z/m);

  const read = await readTaskMarkdownFile({ projectRoot, taskName: "manual-claim-flow" });
  assert.equal(read.claimedCount, 2);
  assert.equal(read.items[0].claimedBy, "agent-alpha");
  assert.equal(read.items[0].claimSessionId, "session-alpha");
  assert.equal(read.items[1].claimedBy, "agent-alpha");

  await assert.rejects(
    () => claimTaskMarkdownItems({
      projectRoot,
      taskName: "manual-claim-flow.task.md",
      items: [1],
      assignee: "agent-beta",
    }),
    /already claimed: 1 by agent-alpha/,
  );
});

test("atomically claims the next open checklist item across concurrent agents", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-files-"));
  await createTaskMarkdownFile({
    projectRoot,
    title: "Concurrent claim flow",
    tasks: [
      "Implement the API",
      "Wire the UI",
      "Add tests",
    ],
  });

  const claims = await Promise.all(["alpha", "beta", "gamma"].map((name) => claimNextTaskMarkdownItem({
    projectRoot,
    taskName: "Concurrent claim flow",
    assignee: `agent-${name}`,
    sessionId: `session-${name}`,
    claimedAt: "2026-05-14T00:00:00.000Z",
  })));

  assert.deepEqual(claims.map((claim) => claim.hasWork), [true, true, true]);
  assert.equal(new Set(claims.map((claim) => claim.claimed[0].index)).size, 3);
  assert.equal(new Set(claims.map((claim) => claim.claimed[0].claimSessionId)).size, 3);

  const empty = await claimNextTaskMarkdownItem({
    projectRoot,
    taskName: "Concurrent claim flow",
    assignee: "agent-delta",
    sessionId: "session-delta",
  });
  assert.equal(empty.hasWork, false);
  assert.deepEqual(empty.claimed, []);
});

test("completes only items claimed by the same assignee and session", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-files-"));
  await createTaskMarkdownFile({
    projectRoot,
    title: "Completion claim flow",
    tasks: ["Implement the API"],
  });

  const claimed = await claimNextTaskMarkdownItem({
    projectRoot,
    taskName: "Completion claim flow",
    assignee: "agent-alpha",
    sessionId: "session-alpha",
    claimedAt: "2026-05-14T00:00:00.000Z",
  });
  assert.equal(claimed.claimed[0].checked, false);

  await assert.rejects(
    () => completeTaskMarkdownItems({
      projectRoot,
      taskName: "Completion claim flow",
      items: [1],
      assignee: "agent-alpha",
      sessionId: "session-beta",
    }),
    /not claimed by agent-alpha\/session-beta/,
  );

  const completed = await completeTaskMarkdownItems({
    projectRoot,
    taskName: "Completion claim flow",
    items: [1],
    assignee: "agent-alpha",
    sessionId: "session-alpha",
  });
  assert.equal(completed.completed[0].checked, true);
  assert.match(completed.markdown, /^- \[x\] Implement the API/m);
});

test("parses legacy claim markers without session ids", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-task-files-"));
  const taskDir = path.join(projectRoot, "task");
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, "legacy.task.md"), [
    "# Legacy claim",
    "",
    "## Tasks",
    "",
    "- [ ] Keep old markers readable",
    "  - AgentDesk claim: `agent-old` at 2026-05-14T00:00:00.000Z; note: old format",
    "",
  ].join("\n"), "utf8");

  const read = await readTaskMarkdownFile({ projectRoot, taskName: "legacy.task.md" });
  assert.equal(read.items[0].claimedBy, "agent-old");
  assert.equal(read.items[0].claimSessionId, "");
  assert.equal(read.items[0].claimNote, "old format");
});
