#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
SOURCE_DIR="${AGENT_DESK_SKILLS_SOURCE:-$PROJECT_ROOT/skills}"

if [ -z "${CODEX_HOME:-}" ]; then
  if [ -z "${HOME:-}" ]; then
    echo "CODEX_HOME is not set and HOME is unavailable." >&2
    exit 1
  fi
  CODEX_HOME="$HOME/.codex"
fi

TARGET_DIR="${AGENT_DESK_CODEX_SKILLS_DIR:-$CODEX_HOME/skills}"
tmp_target=""

cleanup() {
  if [ -n "$tmp_target" ] && [ -e "$tmp_target" ]; then
    rm -rf "$tmp_target"
  fi
}
trap cleanup EXIT HUP INT TERM

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Skill source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

if [ -f "$SCRIPT_DIR/check-github-version.sh" ]; then
  sh "$SCRIPT_DIR/check-github-version.sh" --repo "$PROJECT_ROOT" || true
fi

mkdir -p "$TARGET_DIR"

count=0
for skill_dir in "$SOURCE_DIR"/*; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || continue

  skill_name=$(basename "$skill_dir")
  target="$TARGET_DIR/$skill_name"
  tmp_target="$TARGET_DIR/.$skill_name.tmp.$$"

  rm -rf "$tmp_target"
  cp -R "$skill_dir" "$tmp_target"
  rm -rf "$target"
  mv "$tmp_target" "$target"
  printf '%s\n' "$PROJECT_ROOT" > "$target/.agentdesk-source-root"
  tmp_target=""

  count=$((count + 1))
  echo "Synced $skill_name -> $target"
done

if [ "$count" -eq 0 ]; then
  echo "No Codex skills found in $SOURCE_DIR" >&2
  exit 1
fi

echo "Synced $count Codex skill(s) to $TARGET_DIR."
