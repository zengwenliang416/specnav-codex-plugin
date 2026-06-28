#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPS="$ROOT/plugins/specnav-operations"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

run_gate() {
  local project="$1"
  local output="$2"
  local expected="$3"
  local status

  set +e
  PROJECT_DIR="$project" node "$OPS/scripts/operations-gate.js" --json >"$output"
  status=$?
  set -e
  if [[ "$status" != "$expected" ]]; then
    echo "expected operations-gate status $expected, got $status" >&2
    cat "$output" >&2
    exit 1
  fi
}

assert_blocker() {
  local output="$1"
  local blocker="$2"

  jq -e --arg blocker "$blocker" '.blockers[] | select(. == $blocker)' "$output" >/dev/null
}

write_project() {
  local project="$1"
  local change="add-dashboard"
  local change_dir="$project/openspec/changes/$change"
  local ops="$change_dir/operations"

  mkdir -p "$project/openspec/.specnav" "$change_dir/development" "$change_dir/verify" "$ops"
  printf '%s\n' "$change" >"$project/openspec/.specnav/active-change"

  cat >"$change_dir/tasks.md" <<'MD'
# Development Tasks

- [x] user can view dashboard summary with loading empty and error states
MD
  cat >"$change_dir/development/handoff-to-verify.md" <<'MD'
# Development Handoff
## Implemented Slices
Dashboard summary.
MD
  cat >"$change_dir/verify/aggregate-report.md" <<'MD'
# Aggregate Report
green
MD
  cat >"$change_dir/verify/aggregate-report.json" <<'JSON'
{"schema_version":1,"active_change":"add-dashboard","verdict":"green","blockers":[]}
JSON
  cat >"$change_dir/verify/receipt.json" <<'JSON'
{"schema_version":1,"change_id":"add-dashboard","covered_scope":["dashboard summary"],"uncovered_scope":[],"residual_risk":[],"confidence":"A"}
JSON
  : >"$change_dir/verify/blocker-classification.jsonl"

  cat >"$ops/readiness.md" <<'MD'
# Operations Readiness
## Operations Scope
local-only fixture.
## Readiness Decision
Ready.
## Evidence
Green verification and completed checkbox tasks.
MD
  cat >"$ops/readiness.json" <<'JSON'
{
  "schema": "specnav.ops.readiness.v1",
  "change": "add-dashboard",
  "release_target": "local-only",
  "verification": {
    "aggregate_verdict": "green",
    "receipt_confidence": "A",
    "uncovered_scope": [],
    "residual_risk": []
  },
  "git": {
    "branch": "feature/add-dashboard",
    "worktree_mode": "normal",
    "dirty": false,
    "untracked_reviewed": true
  },
  "docs": {
    "user_facing": false,
    "changelog": false,
    "release_notes": false,
    "readme_updated": false
  },
  "ops": {
    "postmortem_required": false
  },
  "ready": true
}
JSON
  cat >"$ops/release-plan.md" <<'MD'
# Release Plan
## Release Target
local-only.
## Required Artifacts
Readiness, checklist, branch finish, and update-spec.
## Release Decision
Proceed after operations gate.
MD
  cat >"$ops/release-checklist.json" <<'JSON'
{"schema":"specnav.ops.releaseChecklist.v1","change":"add-dashboard","release_target":"local-only","checks":[{"name":"verification","status":"pass"}]}
JSON
  cat >"$ops/branch-finish.md" <<'MD'
# Branch Finish
## Branch State
normal worktree.
## Finish Action
keep local.
## Cleanup Decision
none.
## Provenance
fixture.
MD
  cat >"$ops/update-spec.json" <<'JSON'
{"schema":"specnav.ops.updateSpec.v1","change":"add-dashboard","status":"no_writeback_needed","learning_items":[],"unresolved_items":[]}
JSON
}

PROJECT="$TMP_DIR/project"
write_project "$PROJECT"
run_gate "$PROJECT" "$TMP_DIR/ok.json" 0
jq -e '.ok == true' "$TMP_DIR/ok.json" >/dev/null

NO_CHECKBOX="$TMP_DIR/no-checkbox"
cp -R "$PROJECT" "$NO_CHECKBOX"
cat >"$NO_CHECKBOX/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

- user can view dashboard summary with loading empty and error states
MD
run_gate "$NO_CHECKBOX" "$TMP_DIR/no-checkbox.json" 2
assert_blocker "$TMP_DIR/no-checkbox.json" 'tasks-md:no-checkboxes'

INCOMPLETE="$TMP_DIR/incomplete"
cp -R "$PROJECT" "$INCOMPLETE"
cat >"$INCOMPLETE/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

- [ ] user can view dashboard summary with loading empty and error states
MD
run_gate "$INCOMPLETE" "$TMP_DIR/incomplete.json" 2
assert_blocker "$TMP_DIR/incomplete.json" 'tasks-md:incomplete-checkboxes'
assert_blocker "$TMP_DIR/incomplete.json" 'tasks-md:no-completed-checkboxes'

echo "task checkbox contract fixtures ok"
