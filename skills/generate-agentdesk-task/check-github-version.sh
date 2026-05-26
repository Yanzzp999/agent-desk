#!/usr/bin/env sh
set -u

case "${AGENT_DESK_SKIP_UPDATE_CHECK:-}" in
  1|true|TRUE|yes|YES)
    exit 0
    ;;
esac

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
PROJECT_CHECK="$SCRIPT_DIR/../../scripts/check-github-version.sh"

if [ ! -f "$SCRIPT_DIR/SKILL.md" ]; then
  exit 0
fi

warn_if_installed_copy_is_stale() {
  source_root="$1"
  source_skill="$source_root/skills/generate-agentdesk-task/SKILL.md"

  if [ -f "$source_skill" ] && ! cmp -s "$SCRIPT_DIR/SKILL.md" "$source_skill"; then
    echo "AgentDesk skill update available: installed generate-agentdesk-task differs from the local AgentDesk checkout." >&2
    echo "  Update with: ./scripts/sync-codex-skills.sh from $source_root" >&2
  fi
}

source_root_file="$SCRIPT_DIR/.agentdesk-source-root"
if [ -f "$source_root_file" ]; then
  source_root=$(sed -n '1p' "$source_root_file")
  source_check="$source_root/scripts/check-github-version.sh"
  if [ -n "$source_root" ] && [ -f "$source_check" ]; then
    sh "$source_check" --repo "$source_root" 2>&1
    warn_if_installed_copy_is_stale "$source_root"
    exit 0
  fi
fi

if [ -f "$PROJECT_CHECK" ]; then
  project_root=$(CDPATH= cd "$SCRIPT_DIR/../.." && pwd)
  sh "$PROJECT_CHECK" --repo "$project_root" 2>&1
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  exit 0
fi

branch="${AGENT_DESK_GITHUB_BRANCH:-agentdesk/next}"
raw_url="${AGENT_DESK_GENERATE_SKILL_RAW_URL:-https://raw.githubusercontent.com/Yanzzp999/agent-desk/refs/heads/${branch}/skills/generate-agentdesk-task/SKILL.md}"
tmp_file="${TMPDIR:-/tmp}/agentdesk-generate-skill-latest.$$"

cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT HUP INT TERM

if ! curl -fsSL --max-time "${AGENT_DESK_UPDATE_CHECK_TIMEOUT_SECONDS:-5}" "$raw_url" -o "$tmp_file" 2>/dev/null; then
  exit 0
fi

if [ -s "$tmp_file" ] && ! cmp -s "$SCRIPT_DIR/SKILL.md" "$tmp_file"; then
  echo "AgentDesk skill update available: generate-agentdesk-task differs from GitHub ${branch}." >&2
  echo "  Update with: ./scripts/sync-codex-skills.sh from an up-to-date AgentDesk checkout." >&2
fi

exit 0
