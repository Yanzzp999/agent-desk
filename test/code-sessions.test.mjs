import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listCodeSessions } from "../src/lib/code-sessions.mjs";

test("listCodeSessions matches Codex sessions to a project root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-code-sessions-"));
  const sessionsRoot = path.join(root, "sessions", "2026", "05", "13");
  const projectA = path.join(root, "project-a");
  const projectB = path.join(root, "project-b");
  await fs.mkdir(sessionsRoot, { recursive: true });
  await fs.mkdir(projectA, { recursive: true });
  await fs.mkdir(projectB, { recursive: true });

  await writeSession(path.join(sessionsRoot, "rollout-a.jsonl"), {
    id: "session-a",
    cwd: projectA,
    userText: "Build sidebar session view",
    timestamp: "2026-05-13T08:00:00.000Z",
  });
  await writeSession(path.join(sessionsRoot, "rollout-b.jsonl"), {
    id: "session-b",
    cwd: projectB,
    userText: "Tune unrelated project",
    timestamp: "2026-05-13T09:00:00.000Z",
  });

  const result = await listCodeSessions({
    roots: [{ label: "Test sessions", path: path.join(root, "sessions"), recursive: true }],
    projectRoot: projectA,
    limit: 10,
  });

  assert.equal(result.exactCount, 1);
  assert.equal(result.items[0].conversationId, "session-a");
  assert.equal(result.items[0].title, "Build sidebar session view");
  assert.equal(result.recentItems.length, 2);
  assert.equal(result.roots[0].exists, true);
});

test("listCodeSessions skips AGENTS instruction blocks when choosing titles", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-code-title-"));
  const sessionsRoot = path.join(root, "sessions");
  const projectRoot = path.join(root, "project");
  await fs.mkdir(sessionsRoot, { recursive: true });
  await fs.mkdir(projectRoot, { recursive: true });

  await fs.writeFile(path.join(sessionsRoot, "rollout-title.jsonl"), [
    JSON.stringify({
      timestamp: "2026-05-13T08:00:00.000Z",
      type: "session_meta",
      payload: { id: "session-title", cwd: projectRoot },
    }),
    JSON.stringify({
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "# AGENTS.md instructions for /tmp/project\n\n<INSTRUCTIONS>" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-13T08:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "/goal Add native project picker" }],
      },
    }),
    "",
  ].join("\n"));

  const result = await listCodeSessions({
    roots: [{ label: "Test sessions", path: sessionsRoot, recursive: true }],
    projectRoot,
  });

  assert.equal(result.items[0].title, "/goal Add native project picker");
  assert.deepEqual(result.items[0].prompts, ["/goal Add native project picker"]);
});

async function writeSession(filePath, session) {
  const lines = [
    {
      timestamp: session.timestamp,
      type: "session_meta",
      payload: {
        id: session.id,
        timestamp: session.timestamp,
        cwd: session.cwd,
        originator: "codex_cli",
      },
    },
    {
      timestamp: session.timestamp,
      type: "turn_context",
      payload: {
        cwd: session.cwd,
        model: "gpt-5.5",
        effort: "xhigh",
      },
    },
    {
      timestamp: session.timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: session.userText }],
      },
    },
  ];
  await fs.writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}
