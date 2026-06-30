#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPS="$ROOT/plugins/specnav-operations"
CODEGRAPH="$ROOT/plugins/specnav-codegraph"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

node --check "$CODEGRAPH/core/codegraph-decision-engine.js"
node --check "$CODEGRAPH/core/codegraph-claim-planner.js"
node --check "$CODEGRAPH/scripts/codegraph-plan.js"
node --check "$OPS/scripts/operations-gate.js"

PROJECT="$TMP_DIR/project"
CHANGE="codegraph-policy-check"
mkdir -p "$PROJECT/openspec/.specnav" "$PROJECT/openspec/changes/$CHANGE/operations"
printf '%s\n' "$CHANGE" >"$PROJECT/openspec/.specnav/active-change"

invalid_stage_json="$TMP_DIR/invalid-stage.json"
if PROJECT_DIR="$PROJECT" node "$CODEGRAPH/scripts/codegraph-plan.js" --stage unknown --json >"$invalid_stage_json"; then
  echo "expected codegraph-plan to block invalid stage" >&2
  exit 1
fi
jq -e '.blockers | index("invalid-stage")' "$invalid_stage_json" >/dev/null

default_json="$TMP_DIR/default.json"
PROJECT_DIR="$PROJECT" node "$OPS/scripts/operations-gate.js" --json >"$default_json" || true
jq -e '.codegraph.decision.result == "warn"' "$default_json" >/dev/null
jq -e '.warnings | index("codegraph:not-indexed")' "$default_json" >/dev/null
jq -e '(.blockers | index("codegraph:not-indexed")) == null' "$default_json" >/dev/null
jq -e '.codegraph.evidence_index.raw_exists == false' "$default_json" >/dev/null
test -f "$PROJECT/openspec/changes/$CHANGE/codegraph/status.json"
test -f "$PROJECT/openspec/changes/$CHANGE/codegraph/decision.json"
test -f "$PROJECT/openspec/changes/$CHANGE/codegraph/guard-report.json"
test -f "$PROJECT/openspec/changes/$CHANGE/codegraph/evidence-index.json"
test -f "$PROJECT/openspec/changes/$CHANGE/codegraph/drift-report.json"
test -f "$PROJECT/openspec/changes/$CHANGE/codegraph/claims-report.json"

printf '%s\n' '{"codegraph_policy":{"mode":"required","operations_required":true}}' >"$PROJECT/.specnav.json"
required_json="$TMP_DIR/required.json"
PROJECT_DIR="$PROJECT" node "$OPS/scripts/operations-gate.js" --json >"$required_json" || true
jq -e '.codegraph.decision.result == "block"' "$required_json" >/dev/null
jq -e '.codegraph.decision.required_for_stage == true' "$required_json" >/dev/null
jq -e '.blockers | index("codegraph:not-indexed")' "$required_json" >/dev/null
jq -e '.blockers | index("codegraph:coverage-gap")' "$required_json" >/dev/null
jq -e '.blockers | index("codegraph:missing-claims-map")' "$required_json" >/dev/null

echo "specnav codegraph policy fixtures ok"
