#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPS="$ROOT/plugins/specnav-operations"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

run_gate() {
  local script="$1"
  local project="$2"
  local output="$3"
  local expected="$4"
  local status

  set +e
  PROJECT_DIR="$project" node "$OPS/scripts/$script" --json >"$output"
  status=$?
  set -e
  if [[ "$status" != "$expected" ]]; then
    echo "expected $script status $expected, got $status" >&2
    cat "$output" >&2
    exit 1
  fi
}

assert_blocker() {
  local output="$1"
  local blocker="$2"

  jq -e --arg blocker "$blocker" '.blockers[] | select(. == $blocker)' "$output" >/dev/null
}

write_verified_project() {
  local project="$1"
  local change="add-dashboard"
  local change_dir="$project/openspec/changes/$change"

  mkdir -p "$project/openspec/.specnav" "$change_dir/development" "$change_dir/verify"
  printf '%s\n' "$change" >"$project/openspec/.specnav/active-change"

  cat >"$change_dir/tasks.md" <<'MD'
# Development Tasks

- [x] user can view dashboard summary with loading empty and error states
MD

  cat >"$change_dir/development/handoff-to-verify.md" <<'MD'
# Development Handoff
## Implemented Slices
Dashboard summary.
## Files Changed
src/dashboard/DashboardView.tsx.
## Requirements Covered
Dashboard states.
## Prototype Decisions Implemented
Balanced variant.
## Components Created / Reused / Extracted
DashboardView created.
## API / Data Flow Changes
Summary API flow.
## Tests Added
Dashboard tests.
## Local Validation
npm test passed.
## Known Risks
None.
## Items Requiring Six-Domain Verification
All six domains.
MD
  cat >"$change_dir/verify/aggregate-report.md" <<'MD'
# SpecNav Aggregate Verification Report
## Result
green
MD
  cat >"$change_dir/verify/aggregate-report.json" <<'JSON'
{"schema_version":1,"active_change":"add-dashboard","verdict":"green","blockers":[]}
JSON
  cat >"$change_dir/verify/receipt.json" <<'JSON'
{"schema_version":1,"change_id":"add-dashboard","result":"green","covered_scope":["dashboard summary"],"uncovered_scope":[],"residual_risk":[],"confidence":"A"}
JSON
  : >"$change_dir/verify/blocker-classification.jsonl"
}

write_plugin_marketplace_ops() {
  local project="$1"
  local change_dir="$project/openspec/changes/add-dashboard"
  local ops="$change_dir/operations"
  mkdir -p "$ops"

  cat >"$ops/readiness.md" <<'MD'
# Operations Readiness
## Operations Scope
Plugin marketplace release for dashboard summary.
## Readiness Decision
Ready.
## Evidence
Verification aggregate is green and release artifacts are present.
MD
  cat >"$ops/readiness.json" <<JSON
{
  "schema": "specnav.ops.readiness.v1",
  "change": "add-dashboard",
  "release_target": "plugin-marketplace",
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
    "changelog": true,
    "release_notes": true,
    "readme_updated": true
  },
  "ops": {
    "install_verification": "pass",
    "update_policy": "pass",
    "rollback_plan": "pass",
    "monitor_plan": "pass",
    "postmortem_required": false
  },
  "ready": true
}
JSON
  cat >"$ops/release-plan.md" <<'MD'
# Release Plan
## Release Target
plugin-marketplace.
## Required Artifacts
Checklist, install verification, update policy, compatibility matrix, changelog, release notes, and branch finish.
## Release Decision
Proceed after operations gate.
MD
  cat >"$ops/release-checklist.json" <<'JSON'
{"schema":"specnav.ops.releaseChecklist.v1","change":"add-dashboard","release_target":"plugin-marketplace","checks":[{"name":"verification","status":"pass"},{"name":"install","status":"pass"},{"name":"compatibility","status":"pass"}]}
JSON
  cat >"$ops/install-verification.json" <<'JSON'
{"schema":"specnav.ops.installVerification.v1","marketplace_root":"/repo","plugin_root":"/repo/plugins/specnav-operations","plugin_name":"specnav-operations","plugin_source":"plugins/specnav-operations","target_project":"/project","command":"node plugins/specnav-core/scripts/specnav-doctor.js --json","ok":true,"workspaceSupport":"available","configStatus":"configured","host":"claude-code","discovery_root_checked":true,"reload_required":false}
JSON
  cat >"$ops/update-policy.json" <<'JSON'
{"schema":"specnav.ops.updatePolicy.v1","registry_version":1,"default_scope":"current-host","all_hosts_requires_explicit_request":true,"installations":[{"id":"codex:default","host":"codex","pluginRoot":"/repo/plugins/specnav-operations","discoveryRoot":"/repo","discoveryShape":"plugin-managed","trackedRef":"main","reloadHint":"restart Codex"}]}
JSON
  cat >"$ops/compatibility-matrix.md" <<'MD'
# Compatibility Matrix
## Supported Hosts
- claude-code: fresh-smoke
## Verification Command
node plugins/specnav-core/scripts/specnav-doctor.js --json
## Doctor Result
pass
## Known Limitations
None recorded.
## Reload Requirement
Restart Codex after install.
MD
  cat >"$ops/branch-finish.md" <<'MD'
# Branch Finish
## Branch State
normal worktree on feature/add-dashboard.
## Finish Action
merge to main after tests.
## Cleanup Decision
Preserve worktree until user confirms cleanup.
## Provenance
No SpecNav-owned cleanup marker is present.
MD
  cat >"$ops/changelog.md" <<'MD'
# Changelog
- Add dashboard summary release artifacts.
MD
  cat >"$ops/release-notes.md" <<'MD'
# Release Notes
Dashboard summary is ready for release.
MD
  cat >"$ops/update-spec.json" <<'JSON'
{"schema":"specnav.ops.updateSpec.v1","change":"add-dashboard","status":"no_writeback_needed","learning_items":[],"unresolved_items":[]}
JSON
}

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
    date_prefix="${SPECNAV_FAKE_ARCHIVE_DATE:-2026-06-28}"
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

test -f "$OPS/scripts/operations-gate.js"
test -f "$OPS/scripts/archive-gate.js"
test -f "$OPS/scripts/archive-change.js"
for skill in specnav-ops-readiness specnav-release-plan specnav-install-verify specnav-update-policy specnav-compatibility-matrix specnav-branch-finish specnav-deploy specnav-rollback specnav-monitor specnav-postmortem specnav-update-spec; do
  test -f "$OPS/skills/$skill/SKILL.md"
  grep -q "name: $skill" "$OPS/skills/$skill/SKILL.md"
  grep -Fq 'node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json' "$OPS/skills/$skill/SKILL.md"
done
jq -e '.contracts.operations == "scripts/operations-gate.js"' "$OPS/specnav-stage.json" >/dev/null
jq -e '.contracts.archive == "scripts/archive-gate.js"' "$OPS/specnav-stage.json" >/dev/null
jq -e '.contracts.archive_action == "scripts/archive-change.js"' "$OPS/specnav-stage.json" >/dev/null
jq -e 'has("planned_contracts") | not' "$OPS/specnav-stage.json" >/dev/null

PROJECT="$TMP_DIR/ops-project"
write_verified_project "$PROJECT"
run_gate operations-gate.js "$PROJECT" "$TMP_DIR/missing-ops.json" 2
assert_blocker "$TMP_DIR/missing-ops.json" 'missing-operations-artifact:readiness.json'

write_plugin_marketplace_ops "$PROJECT"
run_gate operations-gate.js "$PROJECT" "$TMP_DIR/valid-ops.json" 0
jq -e '.ok == true and .release_target == "plugin-marketplace"' "$TMP_DIR/valid-ops.json" >/dev/null
run_gate archive-gate.js "$PROJECT" "$TMP_DIR/archive-green.json" 0
jq -e '.verdict == "green"' "$TMP_DIR/archive-green.json" >/dev/null
test -f "$PROJECT/openspec/changes/add-dashboard/operations/archive-gate.json"
test -s "$PROJECT/openspec/changes/add-dashboard/operations/archive-log.jsonl"

FAKE_OPENSPEC="$TMP_DIR/openspec"
write_fake_openspec "$FAKE_OPENSPEC"
ARCHIVE_PROJECT="$TMP_DIR/archive-action"
cp -R "$PROJECT" "$ARCHIVE_PROJECT"
mkdir -p "$ARCHIVE_PROJECT/openspec/changes/next-change" "$ARCHIVE_PROJECT/openspec/changes/add-dashboard/verify/evidence"
printf '%s\n' 'add-dashboard' >"$ARCHIVE_PROJECT/openspec/.specnav/active-change"
cat >"$ARCHIVE_PROJECT/openspec/.specnav/change-registry.json" <<'JSON'
{
  "schema_version": 1,
  "generated_at": "2026-06-28T00:00:00.000Z",
  "current_focus": "add-dashboard",
  "changes": [
    {
      "id": "add-dashboard",
      "stage": "operations",
      "status": "active",
      "branch": "feature/add-dashboard",
      "created_at": "2026-06-28",
      "last_active_at": "2026-06-28"
    },
    {
      "id": "next-change",
      "stage": "requirements",
      "status": "active",
      "branch": "feature/add-dashboard",
      "created_at": "2026-06-28",
      "last_active_at": "2026-06-28"
    }
  ]
}
JSON
cat >"$ARCHIVE_PROJECT/openspec/changes/add-dashboard/requirements.md" <<'MD'
# Requirements
Dashboard requirements.
MD
printf '{}\n' >"$ARCHIVE_PROJECT/openspec/changes/add-dashboard/verify/evidence/screenshot.json"
cat >"$ARCHIVE_PROJECT/openspec/changes/add-dashboard/verify/evidence-index.jsonl" <<'JSONL'
{"id":"REQ","path":"openspec/changes/add-dashboard/requirements.md"}
{"id":"IMG","path":"verify/evidence/screenshot.json"}
JSONL
PROJECT_DIR="$ARCHIVE_PROJECT" SPECNAV_OPENSPEC_BIN="$FAKE_OPENSPEC" SPECNAV_FAKE_ARCHIVE_DATE="2026-06-28" \
  node "$OPS/scripts/archive-change.js" --json >"$TMP_DIR/archive-action.json"
jq -e '.ok == true and .archive_path == "openspec/changes/archive/2026-06-28-add-dashboard" and .active_change_after == "next-change"' "$TMP_DIR/archive-action.json" >/dev/null
test ! -e "$ARCHIVE_PROJECT/openspec/changes/add-dashboard"
test -d "$ARCHIVE_PROJECT/openspec/changes/archive/2026-06-28-add-dashboard"
test -f "$ARCHIVE_PROJECT/openspec/changes/archive/2026-06-28-add-dashboard/operations/archive-receipt.json"
jq -e '.current_focus == "next-change"' "$ARCHIVE_PROJECT/openspec/.specnav/change-registry.json" >/dev/null
jq -e '.changes[] | select(.id == "add-dashboard" and .status == "archived" and .archive_path == "openspec/changes/archive/2026-06-28-add-dashboard")' "$ARCHIVE_PROJECT/openspec/.specnav/change-registry.json" >/dev/null
grep -Fxq 'next-change' "$ARCHIVE_PROJECT/openspec/.specnav/active-change"
grep -Fq 'openspec/changes/archive/2026-06-28-add-dashboard/requirements.md' "$ARCHIVE_PROJECT/openspec/changes/archive/2026-06-28-add-dashboard/verify/evidence-index.jsonl"
grep -Fq 'openspec/changes/archive/2026-06-28-add-dashboard/verify/evidence/screenshot.json' "$ARCHIVE_PROJECT/openspec/changes/archive/2026-06-28-add-dashboard/verify/evidence-index.jsonl"

NO_CHECKBOX="$TMP_DIR/no-checkbox"
cp -R "$PROJECT" "$NO_CHECKBOX"
cat >"$NO_CHECKBOX/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

- user can view dashboard summary with loading empty and error states
MD
run_gate operations-gate.js "$NO_CHECKBOX" "$TMP_DIR/no-checkbox.json" 2
assert_blocker "$TMP_DIR/no-checkbox.json" 'tasks-md:no-checkboxes'
run_gate archive-gate.js "$NO_CHECKBOX" "$TMP_DIR/no-checkbox-archive.json" 2
jq -e '.verdict == "red" and (.blockers[] == "tasks-md:no-checkboxes")' "$TMP_DIR/no-checkbox-archive.json" >/dev/null

INCOMPLETE_TASKS="$TMP_DIR/incomplete-tasks"
cp -R "$PROJECT" "$INCOMPLETE_TASKS"
cat >"$INCOMPLETE_TASKS/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

- [ ] user can view dashboard summary with loading empty and error states
MD
run_gate operations-gate.js "$INCOMPLETE_TASKS" "$TMP_DIR/incomplete-tasks.json" 2
assert_blocker "$TMP_DIR/incomplete-tasks.json" 'tasks-md:incomplete-checkboxes'
assert_blocker "$TMP_DIR/incomplete-tasks.json" 'tasks-md:no-completed-checkboxes'

VERIFY_FAIL="$TMP_DIR/verify-fail"
cp -R "$PROJECT" "$VERIFY_FAIL"
jq '.verdict = "red"' "$VERIFY_FAIL/openspec/changes/add-dashboard/verify/aggregate-report.json" >"$TMP_DIR/verify-fail.tmp"
mv "$TMP_DIR/verify-fail.tmp" "$VERIFY_FAIL/openspec/changes/add-dashboard/verify/aggregate-report.json"
run_gate operations-gate.js "$VERIFY_FAIL" "$TMP_DIR/verify-fail.json" 2
assert_blocker "$TMP_DIR/verify-fail.json" 'verification-not-green'

UNRESOLVED="$TMP_DIR/unresolved"
cp -R "$PROJECT" "$UNRESOLVED"
printf '%s\n' '{"domain":"facticity","blocker_class":"insufficient-evidence","status":"unresolved"}' >"$UNRESOLVED/openspec/changes/add-dashboard/verify/blocker-classification.jsonl"
run_gate operations-gate.js "$UNRESOLVED" "$TMP_DIR/unresolved.json" 2
assert_blocker "$TMP_DIR/unresolved.json" 'unresolved-verification-blocker:facticity'

MISSING_INSTALL="$TMP_DIR/missing-install"
cp -R "$PROJECT" "$MISSING_INSTALL"
rm "$MISSING_INSTALL/openspec/changes/add-dashboard/operations/install-verification.json"
run_gate operations-gate.js "$MISSING_INSTALL" "$TMP_DIR/missing-install.json" 2
assert_blocker "$TMP_DIR/missing-install.json" 'missing-operations-artifact:install-verification.json'

MISSING_README="$TMP_DIR/missing-readme"
cp -R "$PROJECT" "$MISSING_README"
jq '.docs.readme_updated = false' \
  "$MISSING_README/openspec/changes/add-dashboard/operations/readiness.json" >"$TMP_DIR/missing-readme.tmp"
mv "$TMP_DIR/missing-readme.tmp" "$MISSING_README/openspec/changes/add-dashboard/operations/readiness.json"
run_gate operations-gate.js "$MISSING_README" "$TMP_DIR/missing-readme.json" 2
assert_blocker "$TMP_DIR/missing-readme.json" 'readiness-docs-readme'

LOCAL_ONLY="$TMP_DIR/local-only"
cp -R "$PROJECT" "$LOCAL_ONLY"
jq '.release_target = "local-only" | .docs.readme_updated = false | .ops.install_verification = "not_required" | .ops.update_policy = "not_required"' \
  "$LOCAL_ONLY/openspec/changes/add-dashboard/operations/readiness.json" >"$TMP_DIR/local-readiness.tmp"
mv "$TMP_DIR/local-readiness.tmp" "$LOCAL_ONLY/openspec/changes/add-dashboard/operations/readiness.json"
jq '.release_target = "local-only"' "$LOCAL_ONLY/openspec/changes/add-dashboard/operations/release-checklist.json" >"$TMP_DIR/local-checklist.tmp"
mv "$TMP_DIR/local-checklist.tmp" "$LOCAL_ONLY/openspec/changes/add-dashboard/operations/release-checklist.json"
rm "$LOCAL_ONLY/openspec/changes/add-dashboard/operations/install-verification.json"
rm "$LOCAL_ONLY/openspec/changes/add-dashboard/operations/update-policy.json"
rm "$LOCAL_ONLY/openspec/changes/add-dashboard/operations/compatibility-matrix.md"
run_gate operations-gate.js "$LOCAL_ONLY" "$TMP_DIR/local-only.json" 0
jq -e '.release_target == "local-only"' "$TMP_DIR/local-only.json" >/dev/null

# Non-user-facing change: changelog/release-notes are not required and may be absent.
NON_USER_FACING="$TMP_DIR/non-user-facing"
cp -R "$PROJECT" "$NON_USER_FACING"
jq '.docs.user_facing = false | .docs.changelog = false | .docs.release_notes = false' \
  "$NON_USER_FACING/openspec/changes/add-dashboard/operations/readiness.json" >"$TMP_DIR/nuf-readiness.tmp"
mv "$TMP_DIR/nuf-readiness.tmp" "$NON_USER_FACING/openspec/changes/add-dashboard/operations/readiness.json"
rm "$NON_USER_FACING/openspec/changes/add-dashboard/operations/changelog.md"
rm "$NON_USER_FACING/openspec/changes/add-dashboard/operations/release-notes.md"
run_gate operations-gate.js "$NON_USER_FACING" "$TMP_DIR/non-user-facing.json" 0
jq -e '.ok == true' "$TMP_DIR/non-user-facing.json" >/dev/null

# Package target: missing package validation blocks; release notes stay required.
PACKAGE_FAIL="$TMP_DIR/package-fail"
cp -R "$PROJECT" "$PACKAGE_FAIL"
jq '.release_target = "package" | .ops.package_validation = "missing"' \
  "$PACKAGE_FAIL/openspec/changes/add-dashboard/operations/readiness.json" >"$TMP_DIR/pkg-fail-readiness.tmp"
mv "$TMP_DIR/pkg-fail-readiness.tmp" "$PACKAGE_FAIL/openspec/changes/add-dashboard/operations/readiness.json"
jq '.release_target = "package"' "$PACKAGE_FAIL/openspec/changes/add-dashboard/operations/release-checklist.json" >"$TMP_DIR/pkg-fail-checklist.tmp"
mv "$TMP_DIR/pkg-fail-checklist.tmp" "$PACKAGE_FAIL/openspec/changes/add-dashboard/operations/release-checklist.json"
run_gate operations-gate.js "$PACKAGE_FAIL" "$TMP_DIR/package-fail.json" 2
assert_blocker "$TMP_DIR/package-fail.json" 'package-validation'

# Package target satisfied: package validation pass + checksum present when supported.
PACKAGE_OK="$TMP_DIR/package-ok"
cp -R "$PROJECT" "$PACKAGE_OK"
jq '.release_target = "package" | .ops.package_validation = "pass" | .ops.checksum_supported = true | .ops.checksum = "sha256:abc123"' \
  "$PACKAGE_OK/openspec/changes/add-dashboard/operations/readiness.json" >"$TMP_DIR/pkg-ok-readiness.tmp"
mv "$TMP_DIR/pkg-ok-readiness.tmp" "$PACKAGE_OK/openspec/changes/add-dashboard/operations/readiness.json"
jq '.release_target = "package"' "$PACKAGE_OK/openspec/changes/add-dashboard/operations/release-checklist.json" >"$TMP_DIR/pkg-ok-checklist.tmp"
mv "$TMP_DIR/pkg-ok-checklist.tmp" "$PACKAGE_OK/openspec/changes/add-dashboard/operations/release-checklist.json"
run_gate operations-gate.js "$PACKAGE_OK" "$TMP_DIR/package-ok.json" 0
jq -e '.ok == true and .release_target == "package"' "$TMP_DIR/package-ok.json" >/dev/null

DEPLOY_FAIL="$TMP_DIR/deploy-fail"
cp -R "$PROJECT" "$DEPLOY_FAIL"
jq '.release_target = "project-deploy" | .ops.rollback_plan = "missing"' \
  "$DEPLOY_FAIL/openspec/changes/add-dashboard/operations/readiness.json" >"$TMP_DIR/deploy-readiness.tmp"
mv "$TMP_DIR/deploy-readiness.tmp" "$DEPLOY_FAIL/openspec/changes/add-dashboard/operations/readiness.json"
jq '.release_target = "project-deploy"' "$DEPLOY_FAIL/openspec/changes/add-dashboard/operations/release-checklist.json" >"$TMP_DIR/deploy-checklist.tmp"
mv "$TMP_DIR/deploy-checklist.tmp" "$DEPLOY_FAIL/openspec/changes/add-dashboard/operations/release-checklist.json"
cat >"$DEPLOY_FAIL/openspec/changes/add-dashboard/operations/deploy-plan.md" <<'MD'
# Deploy Plan
## Environment
staging
## Command
npm run deploy
## Smoke Checks
GET /health
## Owner
release owner
MD
cat >"$DEPLOY_FAIL/openspec/changes/add-dashboard/operations/monitor-plan.md" <<'MD'
# Monitor Plan
## Signals
health check
## Observation Window
30 minutes
## Escalation
release owner
MD
run_gate operations-gate.js "$DEPLOY_FAIL" "$TMP_DIR/deploy-fail.json" 2
assert_blocker "$TMP_DIR/deploy-fail.json" 'project-deploy-rollback-plan'

MIGRATION_FAIL="$TMP_DIR/migration-fail"
cp -R "$PROJECT" "$MIGRATION_FAIL"
mkdir -p "$MIGRATION_FAIL/openspec/changes/add-dashboard/development/migrations"
cat >"$MIGRATION_FAIL/openspec/changes/add-dashboard/development/migrations/manifest.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "required": true,
  "status": "ready",
  "migrations": [{
    "id": "001-schema",
    "kind": "ddl",
    "order": 1,
    "path": "development/migrations/001-schema.sql"
  }],
  "verification": {
    "commands": ["psql -f openspec/changes/add-dashboard/development/migrations/001-schema.sql"],
    "evidence": ["verify/runtime-evidence.json"]
  },
  "rollback": [{
    "id": "001-schema-rollback",
    "path": "development/migrations/001-schema-rollback.sql"
  }]
}
JSON
cat >"$MIGRATION_FAIL/openspec/changes/add-dashboard/development/migrations/001-schema.sql" <<'SQL'
ALTER TABLE dashboard_summary ADD COLUMN reviewed_at TIMESTAMP NULL;
SQL
cat >"$MIGRATION_FAIL/openspec/changes/add-dashboard/development/migrations/001-schema-rollback.sql" <<'SQL'
ALTER TABLE dashboard_summary DROP COLUMN reviewed_at;
SQL
jq '.release_target = "project-deploy" | .ops.rollback_plan = "pass" | .ops.monitor_plan = "pass" | .ops.migrations = "pass"' \
  "$MIGRATION_FAIL/openspec/changes/add-dashboard/operations/readiness.json" >"$TMP_DIR/migration-readiness.tmp"
mv "$TMP_DIR/migration-readiness.tmp" "$MIGRATION_FAIL/openspec/changes/add-dashboard/operations/readiness.json"
jq '.release_target = "project-deploy"' "$MIGRATION_FAIL/openspec/changes/add-dashboard/operations/release-checklist.json" >"$TMP_DIR/migration-checklist.tmp"
mv "$TMP_DIR/migration-checklist.tmp" "$MIGRATION_FAIL/openspec/changes/add-dashboard/operations/release-checklist.json"
cat >"$MIGRATION_FAIL/openspec/changes/add-dashboard/operations/deploy-plan.md" <<'MD'
# Deploy Plan
## Environment
staging
## Command
npm run deploy
## Smoke Checks
GET /health and apply development/migrations/manifest.json in order.
## Owner
release owner
MD
cat >"$MIGRATION_FAIL/openspec/changes/add-dashboard/operations/rollback-plan.md" <<'MD'
# Rollback Plan
## Triggers
Failed migration smoke checks.
## Rollback Command
Run migration rollback SQL, then revert application deployment.
## Verification
Confirm migration rollback and application health.
MD
cat >"$MIGRATION_FAIL/openspec/changes/add-dashboard/operations/monitor-plan.md" <<'MD'
# Monitor Plan
## Signals
health check and migration query results
## Observation Window
30 minutes
## Escalation
release owner
MD
run_gate operations-gate.js "$MIGRATION_FAIL" "$TMP_DIR/migration-fail.json" 2
assert_blocker "$TMP_DIR/migration-fail.json" 'missing-operations-artifact:migration-deployment.json'

MIGRATION_OK="$TMP_DIR/migration-ok"
cp -R "$MIGRATION_FAIL" "$MIGRATION_OK"
cat >"$MIGRATION_OK/openspec/changes/add-dashboard/operations/migration-deployment.json" <<'JSON'
{
  "schema": "specnav.ops.migrationDeployment.v1",
  "change": "add-dashboard",
  "status": "pass",
  "source_manifest": "development/migrations/manifest.json",
  "applied_migrations": ["001-schema"],
  "evidence_refs": ["verify/runtime-evidence.json", "operations/deploy-plan.md"],
  "rollback_refs": ["development/migrations/001-schema-rollback.sql"],
  "rollback_strategy": "Run migration rollback SQL before reverting application code."
}
JSON
run_gate operations-gate.js "$MIGRATION_OK" "$TMP_DIR/migration-ok.json" 0
jq -e '.ok == true and .release_target == "project-deploy"' "$TMP_DIR/migration-ok.json" >/dev/null

HIGH_RISK="$TMP_DIR/high-risk"
cp -R "$PROJECT" "$HIGH_RISK"
cat >"$HIGH_RISK/openspec/changes/add-dashboard/risk-tier.json" <<'JSON'
{"tier":"high-risk","source":"fixture"}
JSON
run_gate operations-gate.js "$HIGH_RISK" "$TMP_DIR/high-risk.json" 2
assert_blocker "$TMP_DIR/high-risk.json" 'high-risk-signoff'

UPDATE_FAIL="$TMP_DIR/update-fail"
cp -R "$PROJECT" "$UPDATE_FAIL"
jq '.unresolved_items = ["write architecture limitation"]' \
  "$UPDATE_FAIL/openspec/changes/add-dashboard/operations/update-spec.json" >"$TMP_DIR/update-fail.tmp"
mv "$TMP_DIR/update-fail.tmp" "$UPDATE_FAIL/openspec/changes/add-dashboard/operations/update-spec.json"
run_gate operations-gate.js "$UPDATE_FAIL" "$TMP_DIR/update-fail.json" 2
assert_blocker "$TMP_DIR/update-fail.json" 'update-spec-unresolved-items'

echo "specnav operations plugin fixtures ok"
