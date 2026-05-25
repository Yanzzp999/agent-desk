import { describe, expect, it } from "vitest";

import { validateProjectRoot } from "./projectRoot";

describe("validateProjectRoot", () => {
  it("accepts absolute Unix and Windows project roots", () => {
    expect(validateProjectRoot("/Users/me/work/repo").valid).toBe(true);
    expect(validateProjectRoot("C:\\Users\\me\\work\\repo").valid).toBe(true);
  });

  it("rejects empty, relative, and home-relative paths", () => {
    expect(validateProjectRoot("").valid).toBe(false);
    expect(validateProjectRoot("repo").valid).toBe(false);
    expect(validateProjectRoot("~/work/repo").valid).toBe(false);
  });

  it("rejects task.md file paths because AgentDesk needs the repository root", () => {
    const result = validateProjectRoot("/Users/me/work/repo/task/checkout.task.md");

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/repository root/);
  });
});
