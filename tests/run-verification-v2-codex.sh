#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERIFY="$ROOT/plugins/specnav-verification"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$ROOT"

node --test tests/verification-v2/cross-host/codex-adapter.test.js
node --check "$VERIFY/scripts/codex-verification-adapter.js"

node "$VERIFY/scripts/codex-verification-adapter.js" describe --json \
  >"$TMP_DIR/describe.json"
jq -e '
  .ok == true
  and .description.host == "codex"
  and .description.verification_mode == "full"
  and .description.light_mode_supported == false
  and .description.fallback_supported == false
  and (.description.required_domains | length == 6)
' "$TMP_DIR/describe.json" >/dev/null

set +e
node "$VERIFY/scripts/codex-verification-adapter.js" validate \
  --project "$TMP_DIR/project" \
  --mode light \
  --json >"$TMP_DIR/no-light.json"
NO_LIGHT_STATUS=$?
set -e
test "$NO_LIGHT_STATUS" -eq 2
jq -e '
  .ok == false
  and .fallback_used == false
  and (.blocker_ids | index("codex-verification:full-gate-required"))
' "$TMP_DIR/no-light.json" >/dev/null

set +e
node "$VERIFY/scripts/codex-verification-adapter.js" migrate-apply \
  --project "$TMP_DIR/project" \
  --request "$TMP_DIR/migration-request.json" \
  --json >"$TMP_DIR/migration-approval.json"
MIGRATION_STATUS=$?
set -e
test "$MIGRATION_STATUS" -eq 2
jq -e '
  .ok == false
  and (.blocker_ids | index("codex-verification:mutation-approval-required"))
' "$TMP_DIR/migration-approval.json" >/dev/null

jq -e '
  (.skills | index("specnav-verification"))
  and (.skills | index("specnav-verification-runtime-status"))
  and (.skills | index("specnav-verification-runtime-setup"))
  and (.skills | index("specnav-verify-plan"))
  and (.skills | index("specnav-verify-facticity"))
  and (.skills | index("specnav-verify-static"))
  and (.skills | index("specnav-verify-unit"))
  and (.skills | index("specnav-verify-redteam"))
  and (.skills | index("specnav-verify-e2e"))
  and (.skills | index("specnav-verify-sensory"))
  and (.skills | index("specnav-verify-rerun"))
  and (.skills | index("specnav-html-report"))
' "$VERIFY/specnav-stage.json" >/dev/null

grep -Fq 'codex-verification-adapter.js" validate' \
  "$VERIFY/skills/specnav-verification/SKILL.md"
grep -Fq 'Verification 2.0 has no light, compact, or simplified lane.' \
  "$VERIFY/skills/specnav-verification/SKILL.md"
set +e
PROJECT_DIR="$ROOT" node "$ROOT/plugins/specnav-core/scripts/specnav-route.js" \
  --intent "run the full verification suite" \
  --json >"$TMP_DIR/route.json"
ROUTE_STATUS=$?
set -e
test "$ROUTE_STATUS" -eq 0
jq -e '
  .ok == true
  and .route == "verification"
  and .target_plugin == "specnav-verification"
  and .command == "$specnav-verification"
  and .skill == "specnav-verification"
  and .no_fallback == true
' "$TMP_DIR/route.json" >/dev/null
grep -Fq "next_actions: ['\$specnav-status', '\$specnav-requirements']" \
  "$ROOT/plugins/specnav-core/scripts/specnav-bootstrap.js"

echo "verification v2 codex adapter ok"
