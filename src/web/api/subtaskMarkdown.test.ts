import { describe, expect, it } from "vitest";

import { applySubtaskRows, parseSubtaskRows, serializeSubtaskRow } from "./subtaskMarkdown";

describe("parseSubtaskRows", () => {
  it("parses checkbox rows and strips the ad:parallel annotation", () => {
    const md = [
      "## Subtasks",
      "- [ ] Build module  <!-- ad:parallel=2 -->",
      "- [x] Write tests {ad:parallel=1}",
      "- [ ] Update docs",
    ].join("\n");
    expect(parseSubtaskRows(md)).toEqual([
      { title: "Build module", checked: false, parallel: 2 },
      { title: "Write tests", checked: true, parallel: 1 },
      { title: "Update docs", checked: false },
    ]);
  });

  it("ignores non-checklist lines", () => {
    const md = "# Title\n\nSome prose\n\n- a plain bullet\n- [ ] Real subtask";
    expect(parseSubtaskRows(md)).toEqual([{ title: "Real subtask", checked: false }]);
  });
});

describe("serializeSubtaskRow", () => {
  it("re-attaches the parallel annotation only when set", () => {
    expect(serializeSubtaskRow({ title: "X", checked: false })).toBe("- [ ] X");
    expect(serializeSubtaskRow({ title: "Y", checked: true })).toBe("- [x] Y");
    expect(serializeSubtaskRow({ title: "Z", checked: false, parallel: 3 })).toBe(
      "- [ ] Z  <!-- ad:parallel=3 -->",
    );
  });
});

describe("round-trip", () => {
  it("preserves titles, checked state, and parallel across rows -> markdown -> rows", () => {
    const rows = [
      { title: "Refactor auth", checked: false, parallel: 2 },
      { title: "Add migration", checked: false, parallel: 1 },
      { title: "Docs", checked: true },
    ];
    const md = applySubtaskRows("# Existing\n\nGoal text.\n", rows);
    expect(parseSubtaskRows(md)).toEqual(rows);
    // Non-subtask content is preserved.
    expect(md).toContain("# Existing");
    expect(md).toContain("Goal text.");
  });

  it("replaces an existing ## Subtasks section in place", () => {
    const original = [
      "# Task",
      "",
      "## Subtasks",
      "- [ ] old one",
      "",
      "## Notes",
      "keep me",
    ].join("\n");
    const md = applySubtaskRows(original, [{ title: "new one", checked: false }]);
    expect(md).toContain("- [ ] new one");
    expect(md).not.toContain("old one");
    expect(md).toContain("## Notes");
    expect(md).toContain("keep me");
  });
});
