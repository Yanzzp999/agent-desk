import type { SubtaskRow } from "./types";

// Mirror of the backend convention in control-plane.mjs (parseMarkdownChecklist):
// a checklist item may carry a trailing `<!-- ad:parallel=N -->` (or `{ad:parallel=N}`)
// concurrency annotation. Keep this in sync with the backend regex.
const PARALLEL_RE = /\s*(?:<!--\s*ad:parallel=(\d+)\s*-->|\{\s*ad:parallel=(\d+)\s*\})\s*$/i;
const CHECKBOX_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/;

function stripParallel(rawTitle: string): { title: string; parallel?: number } {
  const match = rawTitle.match(PARALLEL_RE);
  if (!match) {
    return { title: rawTitle.trim() };
  }
  const value = Number(match[1] ?? match[2]);
  return {
    title: rawTitle.replace(PARALLEL_RE, "").trim(),
    parallel: Number.isFinite(value) && value > 0 ? value : undefined,
  };
}

/** Parse checklist rows from markdown. Only the explicit `- [ ]` style is parsed for editing. */
export function parseSubtaskRows(markdown: string): SubtaskRow[] {
  const rows: SubtaskRow[] = [];
  const seen = new Set<string>();
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const match = line.match(CHECKBOX_RE);
    if (!match) continue;
    const { title, parallel } = stripParallel(match[2]);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    rows.push({ title, checked: /^[xX]$/.test(match[1]), ...(parallel ? { parallel } : {}) });
  }
  return rows;
}

/** Serialize a single row back to a checklist line, re-attaching its parallel annotation. */
export function serializeSubtaskRow(row: SubtaskRow): string {
  const box = row.checked ? "x" : " ";
  const tag = row.parallel && row.parallel > 0 ? `  <!-- ad:parallel=${row.parallel} -->` : "";
  return `- [${box}] ${row.title.trim()}${tag}`;
}

/**
 * Merge edited subtask rows back into the task markdown, preserving non-subtask content.
 * If the markdown has a `## Subtasks` section, its body is replaced; otherwise a section is appended.
 * If there is no recognizable structure, a minimal document is produced.
 */
export function applySubtaskRows(markdown: string, rows: SubtaskRow[]): string {
  const body = rows
    .filter((row) => row.title.trim().length > 0)
    .map(serializeSubtaskRow)
    .join("\n");
  const section = `## Subtasks\n\n${body}\n`;

  const lines = String(markdown || "").split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##+\s+subtasks\b/i.test(line));

  if (headingIndex === -1) {
    const trimmed = String(markdown || "").trim();
    return trimmed ? `${trimmed}\n\n${section}` : section;
  }

  // Find the end of the Subtasks section (next heading of equal-or-higher level, or EOF).
  let endIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^##+\s+/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }
  const before = lines.slice(0, headingIndex).join("\n").replace(/\s+$/, "");
  const after = lines.slice(endIndex).join("\n").replace(/^\s+/, "");
  const rebuilt = [before, section.trimEnd(), after].filter((part) => part.length > 0).join("\n\n");
  return `${rebuilt}\n`;
}
