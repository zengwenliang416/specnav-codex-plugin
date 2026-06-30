#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS="$ROOT/plugins/specnav-core/hooks/hooks.json"
CORE="$ROOT/plugins/specnav-core"
PAYLOADS="$ROOT/tests/fixtures/hook-payloads"
PROJECT_FIXTURE="$ROOT/tests/fixtures/simple-project"
NO_STATE_FIXTURE="$ROOT/tests/fixtures/no-state"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
PROJECT="$TMP_DIR/simple-project"
NO_STATE="$TMP_DIR/no-state"
cp -R "$PROJECT_FIXTURE" "$PROJECT"
cp -R "$NO_STATE_FIXTURE" "$NO_STATE"

run_case() {
  local name="$1"
  local project="$2"
  local expected="$3"
  local payload="$PAYLOADS/$name.json"
  local out="$TMP_DIR/$name.out"
  local err="$TMP_DIR/$name.err"

  set +e
  PROJECT_DIR="$project" node "$CORE/scripts/specnav-guard.js" <"$payload" >"$out" 2>"$err"
  local status=$?
  set -e

  if [[ "$status" != "$expected" ]]; then
    echo "codex hook fixture failed: $name expected=$expected actual=$status" >&2
    echo "--- stderr ---" >&2
    cat "$err" >&2
    echo "--- stdout ---" >&2
    cat "$out" >&2
    exit 1
  fi
}

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
node --check "$ROOT/plugins/specnav-core/scripts/tasks-md.js"

run_case bash-openspec-propose "$PROJECT" 2
run_case bash-openspec-propose "$NO_STATE" 0

LEGACY_OPENSPEC_PROJECT="$TMP_DIR/legacy-openspec-project"
cp -R "$PROJECT" "$LEGACY_OPENSPEC_PROJECT"
mkdir -p "$LEGACY_OPENSPEC_PROJECT/.claude/skills/openspec-propose" "$LEGACY_OPENSPEC_PROJECT/.claude/commands/opsx"
cat >"$LEGACY_OPENSPEC_PROJECT/.claude/skills/openspec-propose/SKILL.md" <<'MD'
# OpenSpec Propose

Legacy OpenSpec proposal entrypoint.
MD
cat >"$LEGACY_OPENSPEC_PROJECT/.claude/commands/opsx/propose.md" <<'MD'
# OPSX Propose

Legacy OpenSpec command.
MD
run_case write-allowed "$LEGACY_OPENSPEC_PROJECT" 2
run_case openspec-allowed "$LEGACY_OPENSPEC_PROJECT" 0

SPECNAV_DISABLE_OPENSPEC=1 PROJECT_DIR="$LEGACY_OPENSPEC_PROJECT" node "$CORE/scripts/affordances.js" --json >"$TMP_DIR/legacy-affordances.json"
jq -e '.blockers | index("legacy-openspec-workflow")' "$TMP_DIR/legacy-affordances.json" >/dev/null
jq -e '.legacy_openspec_entrypoints[] | select(.name == "openspec-propose")' "$TMP_DIR/legacy-affordances.json" >/dev/null
jq -e '.legacy_openspec_entrypoints[] | select(.name == "opsx/propose")' "$TMP_DIR/legacy-affordances.json" >/dev/null
jq -e '.actions[] | select(.id == "requirements" and (.blocked_by | index("legacy-openspec-workflow")))' "$TMP_DIR/legacy-affordances.json" >/dev/null

echo "codex hook fixtures ok"
