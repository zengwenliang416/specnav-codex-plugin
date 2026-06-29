#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPS="$ROOT/plugins/specnav-operations"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

write_fake_openspec() {
  local bin="$1"

  cat >"$bin" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--no-color" ]]; then
  shift
fi

cmd="${1:-}"
shift || true

case "$cmd" in
  validate)
    exit 0
    ;;
  archive)
    change=""
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --yes|--skip-specs)
          shift
          ;;
        *)
          if [[ -z "$change" ]]; then
            change="$1"
          fi
          shift
          ;;
      esac
    done
    if [[ -z "$change" ]]; then
      echo "missing change" >&2
      exit 2
    fi
    date_prefix="${SPECNAV_FAKE_ARCHIVE_DATE:-2026-06-29}"
    src="openspec/changes/$change"
    dest="openspec/changes/archive/${date_prefix}-${change}"
    if [[ ! -d "$src" ]]; then
      echo "missing source $src" >&2
      exit 2
    fi
    mkdir -p "$(dirname "$dest")" "openspec/specs/$change"
    mv "$src" "$dest"
    printf '# Archived %s\n' "$change" >"openspec/specs/$change/spec.md"
    ;;
  *)
    echo "unexpected openspec command: $cmd" >&2
    exit 2
    ;;
esac
SH
  chmod +x "$bin"
}

write_archive_ready_project() {
  local project="$1"
  local change="add-dashboard"
  local change_dir="$project/openspec/changes/$change"
  local ops="$change_dir/operations"

  mkdir -p "$project/openspec/.specnav" "$change_dir/development" "$change_dir/verify/evidence" "$ops" "$project/openspec/changes/next-change"
  printf '%s\n' "$change" >"$project/openspec/.specnav/active-change"

  cat >"$project/openspec/.specnav/change-registry.json" <<'JSON'
{
  "schema_version": 1,
  "generated_at": "2026-06-29T00:00:00.000Z",
  "current_focus": "add-dashboard",
  "changes": [
    {
      "id": "add-dashboard",
      "stage": "operations",
      "status": "active",
      "branch": "feature/add-dashboard",
      "created_at": "2026-06-29",
      "last_active_at": "2026-06-29"
    },
    {
      "id": "next-change",
      "stage": "requirements",
      "status": "active",
      "branch": "feature/add-dashboard",
      "created_at": "2026-06-29",
      "last_active_at": "2026-06-29"
    }
  ]
}
JSON

  cat >"$change_dir/tasks.md" <<'MD'
# Development Tasks

- [x] user can view dashboard summary with loading empty and error states
MD
  cat >"$change_dir/requirements.md" <<'MD'
# Requirements
Dashboard requirements.
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
  printf '{}\n' >"$change_dir/verify/evidence/screenshot.json"
  cat >"$change_dir/verify/evidence-index.jsonl" <<'JSONL'
{"id":"REQ","path":"openspec/changes/add-dashboard/requirements.md"}
{"id":"IMG","path":"verify/evidence/screenshot.json"}
JSONL

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

test -f "$OPS/scripts/archive-change.js"
jq -e '.contracts.archive_action == "scripts/archive-change.js"' "$OPS/specnav-stage.json" >/dev/null
grep -Fq 'archive-change.js' "$OPS/skills/specnav-ops-readiness/SKILL.md"
grep -Fq 'Do not manually move' "$OPS/skills/specnav-ops-readiness/SKILL.md"

FAKE_OPENSPEC="$TMP_DIR/openspec"
PROJECT="$TMP_DIR/project"
write_fake_openspec "$FAKE_OPENSPEC"
write_archive_ready_project "$PROJECT"

PROJECT_DIR="$PROJECT" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" SPECNAV_FAKE_ARCHIVE_DATE="2026-06-29" \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/archive-action.json"

jq -e '.ok == true and .archive_path == "openspec/changes/archive/2026-06-29-add-dashboard" and .active_change_after == "next-change"' "$TMP_DIR/archive-action.json" >/dev/null
test ! -e "$PROJECT/openspec/changes/add-dashboard"
test -d "$PROJECT/openspec/changes/archive/2026-06-29-add-dashboard"
test -f "$PROJECT/openspec/changes/archive/2026-06-29-add-dashboard/operations/archive-receipt.json"
jq -e '.current_focus == "next-change"' "$PROJECT/openspec/.specnav/change-registry.json" >/dev/null
jq -e '.changes[] | select(.id == "add-dashboard" and .status == "archived" and .archive_path == "openspec/changes/archive/2026-06-29-add-dashboard")' "$PROJECT/openspec/.specnav/change-registry.json" >/dev/null
grep -Fxq 'next-change' "$PROJECT/openspec/.specnav/active-change"
grep -Fq 'openspec/changes/archive/2026-06-29-add-dashboard/requirements.md' "$PROJECT/openspec/changes/archive/2026-06-29-add-dashboard/verify/evidence-index.jsonl"
grep -Fq 'openspec/changes/archive/2026-06-29-add-dashboard/verify/evidence/screenshot.json' "$PROJECT/openspec/changes/archive/2026-06-29-add-dashboard/verify/evidence-index.jsonl"

AMBIGUOUS="$TMP_DIR/ambiguous"
write_archive_ready_project "$AMBIGUOUS"
rm "$AMBIGUOUS/openspec/.specnav/active-change" "$AMBIGUOUS/openspec/.specnav/change-registry.json"
set +e
PROJECT_DIR="$AMBIGUOUS" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/ambiguous.json"
status=$?
set -e
if [[ "$status" != "2" ]]; then
  echo "expected ambiguous archive without focus to block, got $status" >&2
  cat "$TMP_DIR/ambiguous.json" >&2
  exit 1
fi
jq -e '.blockers[] | select(. == "ambiguous-change")' "$TMP_DIR/ambiguous.json" >/dev/null

echo "operations archive action fixtures ok"
