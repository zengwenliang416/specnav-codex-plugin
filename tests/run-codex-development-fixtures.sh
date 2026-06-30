#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV="$ROOT/plugins/specnav-development"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

node --check "$DEV/scripts/development-contract.js"
node --check "$DEV/skills/specnav-vertical-slices/scripts/create-vertical-slice.js"

PROJECT="$TMP_DIR/project"
CHANGE="add-dashboard"
CHANGE_DIR="$PROJECT/openspec/changes/$CHANGE"
mkdir -p "$PROJECT/openspec/.specnav" "$CHANGE_DIR/development"
printf '%s\n' "$CHANGE" >"$PROJECT/openspec/.specnav/active-change"
cat >"$CHANGE_DIR/development/task-context.jsonl" <<'JSONL'
{"status":"pending-vertical-slices","source":"development-entry-scaffold","note":"No task is planned until specnav-vertical-slices creates task packets."}
JSONL

PROJECT_DIR="$PROJECT" node "$DEV/skills/specnav-vertical-slices/scripts/create-vertical-slice.js" --task-id=002-dashboard-detail --json >"$TMP_DIR/create-slice.json"
jq -e '.ok == true' "$TMP_DIR/create-slice.json" >/dev/null
grep -Fq '"task_id":"002-dashboard-detail"' "$CHANGE_DIR/development/task-context.jsonl"
grep -Fq '"status":"task-ready"' "$CHANGE_DIR/development/task-context.jsonl"
if grep -Fq 'development-entry-scaffold' "$CHANGE_DIR/development/task-context.jsonl"; then
  echo "create-vertical-slice left development-entry-scaffold in task-context.jsonl" >&2
  exit 1
fi
if grep -Fq 'pending-vertical-slices' "$CHANGE_DIR/development/task-context.jsonl"; then
  echo "create-vertical-slice left pending-vertical-slices in task-context.jsonl" >&2
  exit 1
fi

echo "codex development fixtures ok"
