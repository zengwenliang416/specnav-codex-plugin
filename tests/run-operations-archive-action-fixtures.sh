#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPS="$ROOT/plugins/specnav-operations"
TMP_DIR="$(mktemp -d)"
if [[ "${SPECNAV_KEEP_TMP:-0}" == "1" ]]; then
  printf 'SpecNav archive fixture temp: %s\n' "$TMP_DIR" >&2
else
  trap 'rm -rf "$TMP_DIR"' EXIT
fi

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
    if [[ "${SPECNAV_FAKE_MUTATE_EVIDENCE:-0}" == "1" && -f "$dest/verify/evidence/raw.jsonl" ]]; then
      printf '%s\n' '{"tampered":true}' >>"$dest/verify/evidence/raw.jsonl"
    fi
    if [[ "${SPECNAV_FAKE_ARCHIVE_EVIDENCE_SYMLINK:-0}" == "1" ]]; then
      rm -f "$dest/verify/evidence/raw.jsonl"
      ln -s "${SPECNAV_FAKE_EVIDENCE_LINK_TARGET:?missing evidence link target}" \
        "$dest/verify/evidence/raw.jsonl"
    fi
    if [[ "${SPECNAV_FAKE_ARCHIVE_SYMLINK:-0}" == "1" ]]; then
      rm -rf "$dest"
      ln -s "${SPECNAV_FAKE_ARCHIVE_LINK_TARGET:?missing symlink target}" "$dest"
    fi
    printf '# Archived %s\n' "$change" >"openspec/specs/$change/spec.md"
    if [[ "${SPECNAV_FAKE_CREATE_UNRELATED_SPEC:-0}" == "1" ]]; then
      mkdir -p "openspec/specs/unrelated"
      printf '%s\n' '# Concurrent unrelated specification' \
        >"openspec/specs/unrelated/spec.md"
    fi
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
node "$ROOT/tests/verification-v2/release/populate-project.js" "$PROJECT" add-dashboard
mkdir -p "$PROJECT/openspec/changes/archive/2026-06-01-add-dashboard"

PROJECT_DIR="$PROJECT" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" SPECNAV_FAKE_ARCHIVE_DATE="2026-06-29" \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/archive-action.json"

jq -e '.ok == true and .archive_path == "openspec/changes/archive/2026-06-29-add-dashboard" and .active_change_after == "next-change"' "$TMP_DIR/archive-action.json" >/dev/null
test ! -e "$PROJECT/openspec/changes/add-dashboard"
test -d "$PROJECT/openspec/changes/archive/2026-06-29-add-dashboard"
test -f "$PROJECT/openspec/changes/archive/2026-06-29-add-dashboard/operations/archive-receipt.json"
jq -e '.current_focus == "next-change"' "$PROJECT/openspec/.specnav/change-registry.json" >/dev/null
jq -e '.changes[] | select(.id == "add-dashboard" and .status == "archived" and .archive_path == "openspec/changes/archive/2026-06-29-add-dashboard")' "$PROJECT/openspec/.specnav/change-registry.json" >/dev/null
grep -Fxq 'next-change' "$PROJECT/openspec/.specnav/active-change"
grep -Fq 'openspec/changes/add-dashboard/requirements.md' "$PROJECT/openspec/changes/archive/2026-06-29-add-dashboard/verify/evidence-index.jsonl"
grep -Fq '"path":"verify/evidence/screenshot.json"' "$PROJECT/openspec/changes/archive/2026-06-29-add-dashboard/verify/evidence-index.jsonl"

MUTATED="$TMP_DIR/mutated"
write_archive_ready_project "$MUTATED"
node "$ROOT/tests/verification-v2/release/populate-project.js" "$MUTATED" add-dashboard
mkdir -p "$MUTATED/openspec/specs/existing"
printf '%s\n' '# Existing specification' >"$MUTATED/openspec/specs/existing/spec.md"
cp "$MUTATED/openspec/.specnav/change-registry.json" "$TMP_DIR/mutated-registry.before"
cp "$MUTATED/openspec/.specnav/active-change" "$TMP_DIR/mutated-active.before"
cp "$MUTATED/openspec/changes/add-dashboard/verify/evidence/raw.jsonl" \
  "$TMP_DIR/mutated-evidence.before"
cp "$MUTATED/openspec/specs/existing/spec.md" "$TMP_DIR/mutated-spec.before"
set +e
PROJECT_DIR="$MUTATED" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" \
  SPECNAV_FAKE_ARCHIVE_DATE="2026-06-30" SPECNAV_FAKE_MUTATE_EVIDENCE=1 \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/mutated.json"
status=$?
set -e
if [[ "$status" != "2" ]]; then
  echo "expected mutated archive evidence to block, got $status" >&2
  cat "$TMP_DIR/mutated.json" >&2
  exit 1
fi
jq -e '.blockers[] | select(startswith("verification-operations:archive-evidence-mutation:"))' \
  "$TMP_DIR/mutated.json" >/dev/null
test -d "$MUTATED/openspec/changes/add-dashboard"
test ! -e "$MUTATED/openspec/changes/archive/2026-06-30-add-dashboard"
test ! -e "$MUTATED/openspec/specs/add-dashboard/spec.md"
cmp "$TMP_DIR/mutated-registry.before" "$MUTATED/openspec/.specnav/change-registry.json"
cmp "$TMP_DIR/mutated-active.before" "$MUTATED/openspec/.specnav/active-change"
cmp "$TMP_DIR/mutated-evidence.before" \
  "$MUTATED/openspec/changes/add-dashboard/verify/evidence/raw.jsonl"
cmp "$TMP_DIR/mutated-spec.before" "$MUTATED/openspec/specs/existing/spec.md"

GRANULAR="$TMP_DIR/granular"
write_archive_ready_project "$GRANULAR"
node "$ROOT/tests/verification-v2/release/populate-project.js" "$GRANULAR" add-dashboard
cat >"$GRANULAR/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

- user can view dashboard summary with loading empty and error states
MD
cp "$GRANULAR/openspec/changes/add-dashboard/tasks.md" \
  "$TMP_DIR/granular-tasks.before"
set +e
PROJECT_DIR="$GRANULAR" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/granular.json"
status=$?
set -e
if [[ "$status" != "2" ]]; then
  echo "expected granular rollback fixture to block, got $status" >&2
  cat "$TMP_DIR/granular.json" >&2
  exit 1
fi
cmp "$TMP_DIR/granular-tasks.before" \
  "$GRANULAR/openspec/changes/add-dashboard/tasks.md"

CONCURRENT="$TMP_DIR/concurrent"
write_archive_ready_project "$CONCURRENT"
node "$ROOT/tests/verification-v2/release/populate-project.js" "$CONCURRENT" add-dashboard
set +e
PROJECT_DIR="$CONCURRENT" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" \
  SPECNAV_FAKE_ARCHIVE_DATE="2026-06-30" \
  SPECNAV_FAKE_MUTATE_EVIDENCE=1 \
  SPECNAV_FAKE_CREATE_UNRELATED_SPEC=1 \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/concurrent.json"
status=$?
set -e
if [[ "$status" != "2" ]]; then
  echo "expected concurrent spec rollback fixture to block, got $status" >&2
  cat "$TMP_DIR/concurrent.json" >&2
  exit 1
fi
grep -Fxq '# Concurrent unrelated specification' \
  "$CONCURRENT/openspec/specs/unrelated/spec.md"
test ! -e "$CONCURRENT/openspec/specs/add-dashboard"

SYMLINK_EVIDENCE="$TMP_DIR/symlink-evidence"
write_archive_ready_project "$SYMLINK_EVIDENCE"
node "$ROOT/tests/verification-v2/release/populate-project.js" "$SYMLINK_EVIDENCE" add-dashboard
printf '%s\n' '{"external":true}' >"$TMP_DIR/external-evidence.jsonl"
rm "$SYMLINK_EVIDENCE/openspec/changes/add-dashboard/verify/evidence/raw.jsonl"
ln -s "$TMP_DIR/external-evidence.jsonl" \
  "$SYMLINK_EVIDENCE/openspec/changes/add-dashboard/verify/evidence/raw.jsonl"
set +e
PROJECT_DIR="$SYMLINK_EVIDENCE" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/symlink-evidence.json"
status=$?
set -e
if [[ "$status" != "2" ]]; then
  echo "expected symlinked evidence to block, got $status" >&2
  cat "$TMP_DIR/symlink-evidence.json" >&2
  exit 1
fi
jq -e '.blockers[] | select(. == "verification-operations:archive-source-unsafe:symlink")' \
  "$TMP_DIR/symlink-evidence.json" >/dev/null
test -d "$SYMLINK_EVIDENCE/openspec/changes/add-dashboard"

ARCHIVE_EVIDENCE_SYMLINK="$TMP_DIR/archive-evidence-symlink"
write_archive_ready_project "$ARCHIVE_EVIDENCE_SYMLINK"
node "$ROOT/tests/verification-v2/release/populate-project.js" \
  "$ARCHIVE_EVIDENCE_SYMLINK" add-dashboard
set +e
PROJECT_DIR="$ARCHIVE_EVIDENCE_SYMLINK" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" \
  SPECNAV_FAKE_ARCHIVE_DATE="2026-07-01" \
  SPECNAV_FAKE_ARCHIVE_EVIDENCE_SYMLINK=1 \
  SPECNAV_FAKE_EVIDENCE_LINK_TARGET="$TMP_DIR/external-evidence.jsonl" \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/archive-evidence-symlink.json"
status=$?
set -e
if [[ "$status" != "2" ]]; then
  echo "expected archived evidence symlink to block, got $status" >&2
  cat "$TMP_DIR/archive-evidence-symlink.json" >&2
  exit 1
fi
jq -e '.blockers[] | select(. == "verification-operations:archive-evidence-symlink:verify/evidence/raw.jsonl")' \
  "$TMP_DIR/archive-evidence-symlink.json" >/dev/null
test -d "$ARCHIVE_EVIDENCE_SYMLINK/openspec/changes/add-dashboard"
test ! -e "$ARCHIVE_EVIDENCE_SYMLINK/openspec/changes/archive/2026-07-01-add-dashboard"

SYMLINK_ARCHIVE="$TMP_DIR/symlink-archive"
EXTERNAL_ARCHIVE="$TMP_DIR/external-archive"
write_archive_ready_project "$SYMLINK_ARCHIVE"
node "$ROOT/tests/verification-v2/release/populate-project.js" "$SYMLINK_ARCHIVE" add-dashboard
mkdir -p "$EXTERNAL_ARCHIVE"
set +e
PROJECT_DIR="$SYMLINK_ARCHIVE" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" \
  SPECNAV_FAKE_ARCHIVE_DATE="2026-07-02" SPECNAV_FAKE_ARCHIVE_SYMLINK=1 \
  SPECNAV_FAKE_ARCHIVE_LINK_TARGET="$EXTERNAL_ARCHIVE" \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/symlink-archive.json"
status=$?
set -e
if [[ "$status" != "2" ]]; then
  echo "expected symlinked archive candidate to block, got $status" >&2
  cat "$TMP_DIR/symlink-archive.json" >&2
  exit 1
fi
jq -e '.blockers[] | select(. == "verification-operations:archive-output-symlink")' \
  "$TMP_DIR/symlink-archive.json" >/dev/null
test -d "$SYMLINK_ARCHIVE/openspec/changes/add-dashboard"
test ! -e "$EXTERNAL_ARCHIVE/operations/archive-receipt.json"

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

LOCKED="$TMP_DIR/locked"
write_archive_ready_project "$LOCKED"
node "$ROOT/tests/verification-v2/release/populate-project.js" "$LOCKED" add-dashboard
printf '%s\n' 'other-process:lock-token' >"$LOCKED/openspec/.specnav/archive.lock"
set +e
PROJECT_DIR="$LOCKED" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/locked.json"
status=$?
set -e
if [[ "$status" != "2" ]]; then
  echo "expected concurrent archive lock to block, got $status" >&2
  cat "$TMP_DIR/locked.json" >&2
  exit 1
fi
jq -e '.blockers[] | select(. == "verification-operations:archive-lock:exists")' \
  "$TMP_DIR/locked.json" >/dev/null
test -d "$LOCKED/openspec/changes/add-dashboard"
grep -Fxq 'other-process:lock-token' "$LOCKED/openspec/.specnav/archive.lock"

NO_PYTHON="$TMP_DIR/no-python"
write_archive_ready_project "$NO_PYTHON"
node "$ROOT/tests/verification-v2/release/populate-project.js" "$NO_PYTHON" add-dashboard
set +e
PROJECT_DIR="$NO_PYTHON" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" \
  SPECNAV_PYTHON_BIN="$TMP_DIR/python-does-not-exist" \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/no-python.json"
status=$?
set -e
if [[ "$status" != "2" ]]; then
  echo "expected missing safe filesystem runtime to block, got $status" >&2
  cat "$TMP_DIR/no-python.json" >&2
  exit 1
fi
jq -e '.blockers[] | select(. == "verification-operations:safe-fs-python-unavailable")' \
  "$TMP_DIR/no-python.json" >/dev/null

echo "operations archive action fixtures ok"
