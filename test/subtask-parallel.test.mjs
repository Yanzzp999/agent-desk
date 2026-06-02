import test from "node:test";
import assert from "node:assert/strict";

import { parseMarkdownChecklist, parseTaskMarkdownItems } from "../src/lib/control-plane.mjs";

test("parseMarkdownChecklist strips ad:parallel HTML-comment annotation into a structured field", () => {
  const markdown = [
    "# Demo",
    "",
    "## Subtasks",
    "",
    "- [ ] Refactor auth middleware  <!-- ad:parallel=2 -->",
    "- [x] Add rate-limit tests {ad:parallel=4}",
    "- [ ] Update docs",
  ].join("\n");

  const items = parseMarkdownChecklist(markdown);
  assert.equal(items.length, 3);

  assert.deepEqual(items[0], { title: "Refactor auth middleware", checked: false, parallel: 2 });
  assert.deepEqual(items[1], { title: "Add rate-limit tests", checked: true, parallel: 4 });
  // No annotation → no parallel field, title and checked unchanged.
  assert.deepEqual(items[2], { title: "Update docs", checked: false });
});

test("parseMarkdownChecklist leaves untagged lines byte-for-byte unchanged (backward compatible)", () => {
  const markdown = [
    "- [ ] First task",
    "- [x] Second task done",
  ].join("\n");
  const items = parseMarkdownChecklist(markdown);
  assert.deepEqual(items, [
    { title: "First task", checked: false },
    { title: "Second task done", checked: true },
  ]);
});

test("a title that merely mentions parallel without the ad: prefix is not stripped", () => {
  const items = parseMarkdownChecklist("- [ ] Make the build run in parallel");
  assert.deepEqual(items, [{ title: "Make the build run in parallel", checked: false }]);
});

test("parseTaskMarkdownItems forwards the parallel hint to executable items", () => {
  const markdown = [
    "## Subtasks",
    "- [ ] Exclusive migration <!-- ad:parallel=1 -->",
    "- [ ] Parallelizable work",
  ].join("\n");
  const items = parseTaskMarkdownItems(markdown);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Exclusive migration");
  assert.equal(items[0].parallel, 1);
  assert.equal(items[1].title, "Parallelizable work");
  assert.equal(items[1].parallel, undefined);
});
