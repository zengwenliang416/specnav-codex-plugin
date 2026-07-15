#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/plugins/specnav-core"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

node --check "$CORE/scripts/cross-repo-guard.js"
node --check "$CORE/scripts/cross-repo-announce.js"

WORKSPACE="$TMP_DIR/workspace"
MAIN="$WORKSPACE/main-repo"
INDEXED="$WORKSPACE/indexed-repo"
PLAIN="$WORKSPACE/plain-repo"
mkdir -p "$MAIN/src" "$INDEXED/.codegraph" "$INDEXED/src" "$PLAIN/src"

run_guard() {
  local payload="$1"
  local out="$TMP_DIR/guard.out"
  set +e
  printf '%s' "$payload" | PROJECT_DIR="$MAIN" node "$CORE/scripts/cross-repo-guard.js" >"$out" 2>/dev/null
  GUARD_STATUS=$?
  GUARD_OUT="$(cat "$out")"
  set -e
}

# Grep into an indexed external repo -> deny with the explore command.
run_guard "{\"tool_name\":\"Grep\",\"tool_input\":{\"pattern\":\"OrderApi\",\"path\":\"$INDEXED/src\"}}"
[[ "$GUARD_STATUS" == "2" ]] || { echo "cross-repo: expected deny for Grep into indexed repo, got $GUARD_STATUS"; exit 1; }
echo "$GUARD_OUT" | grep -q "codegraph explore" || { echo "cross-repo: deny message missing explore command"; exit 1; }

# Grep into a non-indexed external repo -> allow.
run_guard "{\"tool_name\":\"Grep\",\"tool_input\":{\"pattern\":\"OrderApi\",\"path\":\"$PLAIN/src\"}}"
[[ "$GUARD_STATUS" == "0" ]] || { echo "cross-repo: expected allow for non-indexed repo, got $GUARD_STATUS"; exit 1; }

# Grep inside the current project -> allow.
run_guard "{\"tool_name\":\"Grep\",\"tool_input\":{\"pattern\":\"OrderApi\",\"path\":\"src\"}}"
[[ "$GUARD_STATUS" == "0" ]] || { echo "cross-repo: expected allow for in-project grep, got $GUARD_STATUS"; exit 1; }

# Bash rg with an absolute external indexed path -> deny.
run_guard "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"rg OrderApi $INDEXED/src\"}}"
[[ "$GUARD_STATUS" == "2" ]] || { echo "cross-repo: expected deny for Bash rg into indexed repo, got $GUARD_STATUS"; exit 1; }

# Bash grep confined to the project -> allow.
run_guard "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -r OrderApi src/\"}}"
[[ "$GUARD_STATUS" == "0" ]] || { echo "cross-repo: expected allow for in-project bash grep, got $GUARD_STATUS"; exit 1; }

# Bash without a search verb but with an external path -> allow (not a search).
run_guard "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat $INDEXED/src/app.ts\"}}"
[[ "$GUARD_STATUS" == "0" ]] || { echo "cross-repo: expected allow for non-search bash, got $GUARD_STATUS"; exit 1; }

# Kill switch.
set +e
printf '%s' "{\"tool_name\":\"Grep\",\"tool_input\":{\"pattern\":\"x\",\"path\":\"$INDEXED/src\"}}" \
  | SPECNAV_CROSS_REPO_REDIRECT=0 PROJECT_DIR="$MAIN" node "$CORE/scripts/cross-repo-guard.js" >/dev/null 2>&1
STATUS=$?
set -e
[[ "$STATUS" == "0" ]] || { echo "cross-repo: kill switch not honored"; exit 1; }

# Announce: sibling with index -> one compact JSON line naming it.
OUT="$(PROJECT_DIR="$MAIN" node "$CORE/scripts/cross-repo-announce.js")"
echo "$OUT" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' >/dev/null \
  || { echo "cross-repo: announce shape wrong"; echo "$OUT"; exit 1; }
echo "$OUT" | jq -e '.hookSpecificOutput.additionalContext | fromjson | .indexed_repos | length == 1' >/dev/null \
  || { echo "cross-repo: announce should list exactly the indexed sibling"; echo "$OUT"; exit 1; }
if [[ "${#OUT}" -gt 1200 ]]; then
  echo "cross-repo: announce output exceeds compact budget (${#OUT} bytes)"; exit 1
fi

# Announce: no indexed siblings -> fully silent.
LONELY="$TMP_DIR/lonely/only-repo"
mkdir -p "$LONELY"
OUT="$(PROJECT_DIR="$LONELY" node "$CORE/scripts/cross-repo-announce.js")"
[[ -z "$OUT" ]] || { echo "cross-repo: announce should be silent with no indexed repos"; echo "$OUT"; exit 1; }

# Announce: explicit declaration of a non-sibling repo.
FAR="$TMP_DIR/elsewhere/far-repo"
mkdir -p "$FAR/.codegraph" "$LONELY/openspec/.specnav"
printf '{"repos":["%s"]}\n' "$FAR" >"$LONELY/openspec/.specnav/cross-repo.json"
OUT="$(PROJECT_DIR="$LONELY" node "$CORE/scripts/cross-repo-announce.js")"
echo "$OUT" | jq -e '.hookSpecificOutput.additionalContext | fromjson | .indexed_repos | length == 1' >/dev/null \
  || { echo "cross-repo: declared repo missing from announce"; echo "$OUT"; exit 1; }

echo "specnav codegraph cross-repo fixtures ok"
