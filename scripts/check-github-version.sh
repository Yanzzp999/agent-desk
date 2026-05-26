#!/usr/bin/env sh
set -u

case "${AGENT_DESK_SKIP_UPDATE_CHECK:-}" in
  1|true|TRUE|yes|YES)
    exit 0
    ;;
esac

usage() {
  echo "Usage: $0 [--repo <repo-root>]" >&2
}

if ! command -v git >/dev/null 2>&1; then
  exit 0
fi

repo_root=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      if [ "$#" -lt 2 ]; then
        usage
        exit 0
      fi
      repo_root="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

if [ -z "$repo_root" ]; then
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
fi

if [ -z "$repo_root" ] || ! git -C "$repo_root" rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

branch="${AGENT_DESK_GITHUB_BRANCH:-agentdesk/next}"
remote_url="${AGENT_DESK_GITHUB_REPO_URL:-https://github.com/Yanzzp999/agent-desk.git}"
local_sha=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || true)
remote_sha=$(git ls-remote --heads "$remote_url" "$branch" 2>/dev/null | awk 'NR == 1 { print $1 }')

if [ -z "$local_sha" ] || [ -z "$remote_sha" ]; then
  exit 0
fi

if [ "$local_sha" != "$remote_sha" ] && ! git -C "$repo_root" merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
  echo "AgentDesk update available: local checkout may be missing commits from GitHub ${branch}." >&2
  echo "  local:  $local_sha" >&2
  echo "  GitHub: $remote_sha" >&2
  echo "  Update with: git -C \"$repo_root\" pull --ff-only" >&2
fi

exit 0
