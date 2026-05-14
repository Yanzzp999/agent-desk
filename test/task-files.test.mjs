import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createTaskMarkdownFile,
  listTaskMarkdownFiles,
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
