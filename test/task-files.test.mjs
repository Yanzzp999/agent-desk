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

test("renders fallback checklist item when tasks are omitted", () => {
  const markdown = renderTaskMarkdown({ title: "Small task" });
  assert.match(markdown, /^## Tasks/m);
  assert.match(markdown, /^- \[ \] Define and implement the requested change/m);
});
