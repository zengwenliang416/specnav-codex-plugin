#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/plugins/specnav-core"
REQ="$ROOT/plugins/specnav-requirements"
PROTO="$ROOT/plugins/specnav-prototype"
DEV="$ROOT/plugins/specnav-development"
VERIFY="$ROOT/plugins/specnav-verification"
OPS="$ROOT/plugins/specnav-operations"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

PROJECT="$TMP_DIR/project"
CHANGE="light-v2-readme"
CHANGE_DIR="$PROJECT/openspec/changes/$CHANGE"
mkdir -p "$PROJECT/openspec/.specnav" "$CHANGE_DIR"
printf '%s\n' "$CHANGE" >"$PROJECT/openspec/.specnav/active-change"
printf '# Fixture\n' >"$PROJECT/README.md"

# 1. create-light-change defaults to the single-file v2 format.
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" \
  node "$DEV/skills/specnav-light-change/scripts/create-light-change.js" \
  --intent "fix typo in README copy" --paths README.md --json >"$TMP_DIR/create.json"
jq -e '.ok == true' "$TMP_DIR/create.json" >/dev/null
test -f "$CHANGE_DIR/light-change.json"
# v2 means ONE artifact, not the 14-file packet.
CREATED_COUNT="$(jq '.files | length' "$TMP_DIR/create.json")"
[[ "$CREATED_COUNT" == "1" ]] || { echo "light v2 should create exactly 1 file, got $CREATED_COUNT"; exit 1; }
test ! -f "$CHANGE_DIR/light-gate.json"
test ! -f "$CHANGE_DIR/scope.json"

# 2. Lane is derived from light-change.json (no risk-tier.json needed).
node -e "
const lib = require('$CORE/scripts/specnav-lib');
const lane = lib.readLane('$CHANGE_DIR');
if (lane.lane !== 'light' || lane.source !== 'light-change.json') { console.error(lane); process.exit(1); }
"

# 3. Requirements / prototype / development entry contracts pass on v2 alone.
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" node "$REQ/scripts/requirements-contract.js" --json >"$TMP_DIR/req.json"
jq -e '.ok == true and .light_format == "v2"' "$TMP_DIR/req.json" >/dev/null
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" node "$PROTO/scripts/prototype-contract.js" --json >"$TMP_DIR/proto.json" 2>/dev/null || true
node -e "
const { validatePrototype } = require('$PROTO/scripts/prototype-contract');
process.env.PROJECT_DIR = '$PROJECT'; process.env.SPECNAV_CHANGE = '$CHANGE';
const r = validatePrototype('$PROJECT');
if (!r.ok || r.light_format !== 'v2') { console.error(JSON.stringify(r.blockers)); process.exit(1); }
"
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" node "$DEV/scripts/development-contract.js" --mode entry --json >"$TMP_DIR/dev-entry.json"
jq -e '.ok == true and .lane == "light" and .light_format == "v2"' "$TMP_DIR/dev-entry.json" >/dev/null

# 4. Guard: edit inside editable_paths allowed; outside is a soft warn / strict deny.
printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"README.md","content":"x"}}' \
  | PROJECT_DIR="$PROJECT" node "$CORE/scripts/specnav-guard.js" >/dev/null
set +e
printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"src/other.ts","content":"x"}}' \
  | SPECNAV_STRICT=1 PROJECT_DIR="$PROJECT" node "$CORE/scripts/specnav-guard.js" >/dev/null 2>&1
STATUS=$?
set -e
[[ "$STATUS" == "2" ]] || { echo "v2 scope should deny out-of-scope edit under strict, got $STATUS"; exit 1; }

# 5. Handoff blocks while tasks/acceptance are open.
set +e
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" node "$DEV/scripts/development-contract.js" --mode handoff --json >"$TMP_DIR/handoff-open.json"
STATUS=$?
set -e
[[ "$STATUS" == "2" ]]
jq -e '.blockers | index("acceptance:non-passing:LIGHT-001")' "$TMP_DIR/handoff-open.json" >/dev/null

# 6. Complete the work inside the single file; handoff + verify + ops go green.
python3 - "$CHANGE_DIR/light-change.json" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
for a in data["acceptance"]:
    a["status"] = "passing"
    a["evidence_ref"] = "git diff README.md"
for t in data["tasks"]:
    t["done"] = True
data["user_test"] = {"status": "approved", "case": data["user_test"]["case"], "user_decision": "Approved: README reads correctly."}
json.dump(data, open(path, "w"), indent=2)
open(path, "a").write("\n")
PY

PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" node "$DEV/scripts/development-contract.js" --mode handoff --json >"$TMP_DIR/handoff-done.json"
jq -e '.ok == true' "$TMP_DIR/handoff-done.json" >/dev/null

PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" node "$VERIFY/scripts/verify-domains.js" aggregate --json >"$TMP_DIR/aggregate.json"
jq -e '.verdict == "green" and .lane == "light"' "$TMP_DIR/aggregate.json" >/dev/null
test -f "$CHANGE_DIR/verify/aggregate-report.json"
# Single-format: no md/html unless --render.
test ! -f "$CHANGE_DIR/verify/aggregate-report.md"
test ! -f "$CHANGE_DIR/verify/aggregate-report.html"

PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" node "$OPS/scripts/operations-gate.js" --json >"$TMP_DIR/ops.json"
jq -e '.ok == true and .lane == "light" and .light_format == "v2"' "$TMP_DIR/ops.json" >/dev/null

PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" node "$OPS/scripts/archive-gate.js" --json >"$TMP_DIR/archive.json"
jq -e '.verdict == "green" and .lane == "light"' "$TMP_DIR/archive.json" >/dev/null

# 7. Cross-repo paths become an external_repos declaration instead of a blocker.
SIBLING="$TMP_DIR/sibling-repo"
mkdir -p "$SIBLING/docs"
CHANGE2="light-v2-cross"
mkdir -p "$PROJECT/openspec/changes/$CHANGE2"
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE2" \
  node "$DEV/skills/specnav-light-change/scripts/create-light-change.js" \
  --intent "fix typo in sibling docs" --paths "README.md,../sibling-repo/docs/guide.md" --json >"$TMP_DIR/create2.json"
jq -e '.ok == true' "$TMP_DIR/create2.json" >/dev/null
jq -e '.external_repos[0].root == "../sibling-repo"' "$PROJECT/openspec/changes/$CHANGE2/light-change.json" >/dev/null

# 8. --format packet still writes the legacy 14-artifact set.
CHANGE3="light-v2-packet"
mkdir -p "$PROJECT/openspec/changes/$CHANGE3"
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE3" \
  node "$DEV/skills/specnav-light-change/scripts/create-light-change.js" \
  --intent "fix typo in README copy" --paths README.md --format packet --json >"$TMP_DIR/create3.json"
jq -e '.ok == true' "$TMP_DIR/create3.json" >/dev/null
test -f "$PROJECT/openspec/changes/$CHANGE3/light-gate.json"
test ! -f "$PROJECT/openspec/changes/$CHANGE3/light-change.json"

echo "specnav light-change v2 fixtures ok"
