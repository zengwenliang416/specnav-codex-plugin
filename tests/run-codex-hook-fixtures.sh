#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS="$ROOT/plugins/specnav-core/hooks/hooks.json"

jq -e '.hooks.SessionStart and .hooks.UserPromptSubmit and .hooks.PreToolUse and .hooks.PostToolUse' "$HOOKS" >/dev/null
grep -Fq '${PLUGIN_ROOT}' "$HOOKS"
if grep -Fq 'CLAUDE_PLUGIN_ROOT' "$HOOKS"; then
  echo "hooks must use PLUGIN_ROOT, not CLAUDE_PLUGIN_ROOT" >&2
  exit 1
fi

node --check "$ROOT/plugins/specnav-core/scripts/specnav-session-start.js"
node --check "$ROOT/plugins/specnav-core/scripts/specnav-user-prompt-submit.js"
node --check "$ROOT/plugins/specnav-core/scripts/specnav-guard.js"
node --check "$ROOT/plugins/specnav-core/scripts/specnav-post-tool.js"

echo "codex hook fixtures ok"
