#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_ROOT="$(cd "$ROOT/../specnav-claude-plugin" && pwd)"
CLAUDE_ADAPTER="$CLAUDE_ROOT/plugins/specnav-verification/scripts/claude-verification-adapter.js"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$ROOT"

node --test tests/verification-v2/cross-host/claude-adapter.test.js
node --check integrations/claude-code/claude-verification-adapter.js
node --check "$CLAUDE_ADAPTER"

node "$CLAUDE_ADAPTER" describe --json \
  >"$TMP_DIR/describe.json"
jq -e '
  .ok == true
  and .description.host == "claude-code"
  and .description.verification_mode == "full"
  and .description.light_mode_supported == false
  and .description.fallback_supported == false
  and (.description.required_domains | length == 6)
' "$TMP_DIR/describe.json" >/dev/null
jq -s -e '
  .[0].description.kernel.name == .[1].kernel.name
  and .[0].description.kernel.version == .[1].kernel.version
  and .[0].description.kernel.apiVersion == .[1].kernel.api_version
  and .[0].description.kernel.contractVersion == .[1].kernel.contract_version
  and .[0].description.kernel.contractDigest == .[1].kernel.contract_digest
' \
  "$TMP_DIR/describe.json" \
  "$CLAUDE_ROOT/plugins/specnav-verification/specnav-kernel-source.json" \
  >/dev/null

set +e
node "$CLAUDE_ADAPTER" validate \
  --project "$TMP_DIR/project" \
  --mode light \
  --json >"$TMP_DIR/no-light.json"
NO_LIGHT_STATUS=$?
set -e
test "$NO_LIGHT_STATUS" -eq 2
jq -e '
  .ok == false
  and .fallback_used == false
  and (.blocker_ids | index("claude-verification:full-gate-required"))
' "$TMP_DIR/no-light.json" >/dev/null

set +e
node "$CLAUDE_ADAPTER" validate \
  --project "$CLAUDE_ROOT/tests/fixtures/simple-project" \
  --json >"$TMP_DIR/downstream-validate.json"
DOWNSTREAM_VALIDATE_STATUS=$?
set -e
test "$DOWNSTREAM_VALIDATE_STATUS" -eq 2
jq -e '
  .ok == false
  and .status == "blocked"
  and .host == "claude-code"
  and .action == "validate"
  and .exit_status == 2
  and .fallback_used == false
  and .result.fallback_used == false
  and (.blocker_ids | index("missing-verify-artifact:user-test-cases.json"))
  and (
    .artifact_paths
    | index("openspec/changes/add-dark-mode/verify/user-test-cases.json")
  )
' "$TMP_DIR/downstream-validate.json" >/dev/null

jq -e '
  (.commands | index("specnav-verification"))
  and (.skills | index("specnav-verification"))
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
' "$CLAUDE_ROOT/plugins/specnav-verification/specnav-stage.json" >/dev/null

grep -Fq 'Verification 2.0 has no light, compact, or simplified lane.' \
  "$CLAUDE_ROOT/plugins/specnav-verification/skills/specnav-verification/SKILL.md"
grep -Fq 'scripts/claude-verification-adapter.js' \
  "$CLAUDE_ROOT/plugins/specnav-verification/commands/specnav-verification.md"

PROJECT_DIR="$CLAUDE_ROOT/tests/fixtures/simple-project" \
  SPECNAV_MARKETPLACE_ROOT="$CLAUDE_ROOT" \
  node "$CLAUDE_ROOT/plugins/specnav-core/scripts/specnav-route.js" \
  --intent "run the full verification suite" \
  --json >"$TMP_DIR/route.json" || true
jq -e '
  .route == "verification"
  and .target_plugin == "specnav-verification"
  and .command == "/specnav-verification"
  and .skill == "specnav-verification"
  and .no_fallback == true
' "$TMP_DIR/route.json" >/dev/null

echo "verification v2 claude adapter ok"
