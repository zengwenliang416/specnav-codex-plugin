#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CODEFREE_ROOT="$(cd "$ROOT/../specnav-codefree-o-plugin" && pwd)"
CODEFREE_MODULE="$CODEFREE_ROOT/modules/specnav-verification"
CODEFREE_ADAPTER="$CODEFREE_MODULE/scripts/codefree-o-verification-adapter.js"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/project/openspec"
cd "$ROOT"

node --test tests/verification-v2/cross-host/codefree-o-adapter.test.js
node --check integrations/codefree-o/codefree-o-verification-adapter.js
node --check integrations/codefree-o/sync-verification-module.js
node --check "$CODEFREE_ADAPTER"

node "$CODEFREE_ADAPTER" describe --json >"$TMP_DIR/describe.json"
jq -e '
  .ok == true
  and .description.host == "codefree-o"
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
  "$CODEFREE_MODULE/specnav-kernel-source.json" \
  >/dev/null

set +e
node "$CODEFREE_ADAPTER" validate \
  --project "$TMP_DIR/project" \
  --mode light \
  --json >"$TMP_DIR/no-light.json"
NO_LIGHT_STATUS=$?
set -e
test "$NO_LIGHT_STATUS" -eq 2
jq -e '
  .ok == false
  and .fallback_used == false
  and (.blocker_ids | index("codefree-o-verification:full-gate-required"))
' "$TMP_DIR/no-light.json" >/dev/null

set +e
node "$CODEFREE_ADAPTER" validate \
  --project "$TMP_DIR/project" \
  --json >"$TMP_DIR/downstream-validate.json"
VALIDATE_STATUS=$?
set -e
test "$VALIDATE_STATUS" -eq 2
jq -e '
  .ok == false
  and .status == "blocked"
  and .host == "codefree-o"
  and .action == "validate"
  and .fallback_used == false
  and .result.fallback_used == false
  and (.blocker_ids | length > 0)
' "$TMP_DIR/downstream-validate.json" >/dev/null

jq -e '
  (.commands | index("specnav-verification"))
  and (.commands | index("specnav-verify"))
  and (.skills | index("specnav-verification"))
  and (.skills | index("specnav-verification-runtime-status"))
  and (.skills | index("specnav-verification-runtime-setup"))
  and (.skills | index("specnav-html-report"))
' "$CODEFREE_MODULE/specnav-stage.json" >/dev/null

grep -Fq 'codefree-o-verification-adapter.js' \
  "$CODEFREE_ROOT/runtime/commands.mjs"
grep -Fq 'Verification 2.0 has no light, compact, or simplified lane.' \
  "$CODEFREE_MODULE/skills/specnav-verification/SKILL.md"

PROJECT_DIR="$TMP_DIR/project" \
  SPECNAV_HOST=codefree-o \
  SPECNAV_PACKAGE_ROOT="$CODEFREE_ROOT" \
  SPECNAV_MARKETPLACE_ROOT="$CODEFREE_ROOT" \
  node "$CODEFREE_ROOT/modules/specnav-core/scripts/specnav-route.js" \
  --intent "run the full verification suite" \
  --json >"$TMP_DIR/route.json" || true
jq -e '
  .route == "verification"
  and .target_plugin == "specnav-verification"
  and .command == "/specnav-verification"
  and .skill == "specnav-verification"
  and .no_fallback == true
' "$TMP_DIR/route.json" >/dev/null

node - "$CODEFREE_MODULE" <<'NODE'
const path = require('node:path');
const moduleRoot = path.resolve(process.argv[2]);
const runtime = require(path.join(moduleRoot, 'scripts/verification-runtime.js'));
if (
  runtime.pluginRepairCommand(moduleRoot)
  !== 'codefree-o plugin github:zengwenliang416/specnav-codefree-o-plugin -g'
) {
  throw new Error('invalid-codefree-o-plugin-repair-command');
}
NODE

echo "verification v2 CodeFree-O adapter ok"
