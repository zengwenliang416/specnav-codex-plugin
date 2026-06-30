#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEGRAPH="$ROOT/plugins/specnav-codegraph"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

node --check "$CODEGRAPH/core/codegraph-status-manager.js"
node --check "$CODEGRAPH/core/codegraph-context-builder.js"
node --check "$CODEGRAPH/scripts/codegraph-plan.js"
node --check "$CODEGRAPH/scripts/codegraph-context.js"
node --check "$CODEGRAPH/scripts/codegraph-claims.js"

PROJECT="$TMP_DIR/project"
CHANGE="codegraph-context-check"
TASK="demo-task"
CHANGE_DIR="$PROJECT/openspec/changes/$CHANGE"
mkdir -p "$PROJECT/openspec/.specnav" "$CHANGE_DIR/development/tasks/$TASK" "$PROJECT/.codegraph" "$PROJECT/src" "$TMP_DIR/bin"
printf '%s\n' "$CHANGE" >"$PROJECT/openspec/.specnav/active-change"
printf '%s\n' 'export function demoTask() { return true; }' >"$PROJECT/src/demo.js"
cat >"$CHANGE_DIR/development/tasks/$TASK/context.json" <<'JSON'
{
  "goal": "Demo task renders the verified flow.",
  "expected_evidence": ["src/demo.js"],
  "allowed_files": ["src/demo.js"]
}
JSON
cat >"$CHANGE_DIR/development/tasks/$TASK/brief.md" <<'MD'
# Demo Task

## Goal

Demo task renders the verified flow.

## Vertical Slice

User can complete the demo flow through src/demo.js.
MD

cat >"$TMP_DIR/bin/codegraph" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cmd="${1:-}"
shift || true
case "$cmd" in
  version)
    printf '1.1.7\n'
    ;;
  status)
    printf '{"initialized":true,"version":"1.1.7","projectPath":"%s","indexPath":"%s/.codegraph","lastIndexed":"2026-07-01T00:00:00.000Z","fileCount":1,"nodeCount":1,"edgeCount":0,"pendingChanges":{"added":0,"modified":0,"removed":0},"reindexRecommended":false}\n' "$PWD" "$PWD"
    ;;
  explore)
    printf 'Symbol demoTask in src/demo.js:1 implements the requested verified flow.\n'
    ;;
  *)
    printf 'unsupported command: %s\n' "$cmd" >&2
    exit 2
    ;;
esac
SH
chmod +x "$TMP_DIR/bin/codegraph"

PATH="$TMP_DIR/bin:$PATH" PROJECT_DIR="$PROJECT" node "$CODEGRAPH/scripts/codegraph-plan.js" --stage development --write --json >"$TMP_DIR/plan.json"
jq -e '.ok == true' "$TMP_DIR/plan.json" >/dev/null
jq -e '.claims_map.claims[] | select(.id == "development:task-demo-task")' "$TMP_DIR/plan.json" >/dev/null

PATH="$TMP_DIR/bin:$PATH" PROJECT_DIR="$PROJECT" node "$CODEGRAPH/scripts/codegraph-context.js" \
  --stage development \
  --claim development:task-demo-task \
  --query "Find demoTask implementation" \
  --write \
  --json >"$TMP_DIR/context.json"
jq -e '.ok == true' "$TMP_DIR/context.json" >/dev/null
jq -e '.evidence.confidence == "matched"' "$TMP_DIR/context.json" >/dev/null
jq -e '.evidence.files[] | select(.path == "src/demo.js")' "$TMP_DIR/context.json" >/dev/null
test -f "$CHANGE_DIR/codegraph/evidence.jsonl"
test -f "$CHANGE_DIR/codegraph/evidence-index.json"
jq -e '.by_claim["development:task-demo-task"].status == "matched"' "$CHANGE_DIR/codegraph/evidence-index.json" >/dev/null

PATH="$TMP_DIR/bin:$PATH" PROJECT_DIR="$PROJECT" node "$CODEGRAPH/scripts/codegraph-claims.js" --json >"$TMP_DIR/claims.json"
jq -e '.ok == true' "$TMP_DIR/claims.json" >/dev/null
jq -e '.verified_claims | index("development:task-demo-task")' "$TMP_DIR/claims.json" >/dev/null
jq -e '.blockers | length == 0' "$TMP_DIR/claims.json" >/dev/null
test -f "$CHANGE_DIR/codegraph/claims-report.json"

mkdir -p "$TMP_DIR/old-bin"
cat >"$TMP_DIR/old-bin/codegraph" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cmd="${1:-}"
shift || true
case "$cmd" in
  version) printf '1.1.1\n' ;;
  status) printf '{"initialized":true,"projectPath":"%s","indexPath":"%s/.codegraph"}\n' "$PWD" "$PWD" ;;
  explore) printf 'src/demo.js:1\n' ;;
  *) exit 2 ;;
esac
SH
chmod +x "$TMP_DIR/old-bin/codegraph"

if PATH="$TMP_DIR/old-bin:$PATH" PROJECT_DIR="$PROJECT" node "$CODEGRAPH/scripts/codegraph-context.js" --query "Find demoTask" --json >"$TMP_DIR/old-context.json"; then
  echo "expected unsupported CodeGraph version to block context evidence" >&2
  exit 1
fi
jq -e '.blockers | index("codegraph:unsupported-version")' "$TMP_DIR/old-context.json" >/dev/null

echo "specnav codegraph context fixtures ok"
