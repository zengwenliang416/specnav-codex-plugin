#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/plugins/specnav-core"
DEV="$ROOT/plugins/specnav-development"
VERIFY="$ROOT/plugins/specnav-verification"
OPS="$ROOT/plugins/specnav-operations"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

PROJECT="$TMP_DIR/project"
CHANGE="light-readme-copy"
CHANGE_DIR="$PROJECT/openspec/changes/$CHANGE"
VERIFY_DIR="$CHANGE_DIR/verify"
mkdir -p "$PROJECT/openspec/.specnav" "$CHANGE_DIR"
printf '%s\n' "$CHANGE" >"$PROJECT/openspec/.specnav/active-change"
printf '# Fixture\n' >"$PROJECT/README.md"

PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" \
  node "$DEV/skills/specnav-light-change/scripts/create-light-change.js" \
  --intent "fix typo in README copy" --paths README.md --json >"$TMP_DIR/light-create.json"
jq -e '.ok == true and (.files[] | select(.path == "openspec/changes/light-readme-copy/light-gate.json"))' "$TMP_DIR/light-create.json" >/dev/null
test -f "$CHANGE_DIR/light-gate.json"
test -f "$VERIFY_DIR/user-test-case-signoff.json"

PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" \
  node "$DEV/scripts/development-contract.js" --mode entry --json >"$TMP_DIR/light-entry.json"
jq -e '.ok == true and .lane == "light" and (.artifacts[] | select(.name == "light-gate.json" and .ok == true))' "$TMP_DIR/light-entry.json" >/dev/null

mv "$CHANGE_DIR/light-gate.json" "$CHANGE_DIR/light-gate.json.bak"
if printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"README.md","content":"# Fixture\n"}}' | \
  PROJECT_DIR="$PROJECT" node "$CORE/scripts/specnav-guard.js" >"$TMP_DIR/guard.out" 2>"$TMP_DIR/guard.err"; then
  echo "expected light entry gate denial" >&2
  exit 1
fi
grep -q 'light-entry:missing' "$TMP_DIR/guard.err"
mv "$CHANGE_DIR/light-gate.json.bak" "$CHANGE_DIR/light-gate.json"

cat >"$VERIFY_DIR/plan.md" <<'MD'
# Verification Plan
## Verification Scope
- Light README copy.
## Required Domains
- static
- unit
## Evidence Plan
- Static file check and minimal smoke check.
MD
cat >"$VERIFY_DIR/plan.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "light-readme-copy",
  "risk_tier": "lite",
  "required_domains": ["static", "unit"],
  "inputs": ["requirements.md", "acceptance.json", "tasks.md"],
  "changed_files": ["README.md"],
  "commands": ["git diff --check", "true"],
  "manual_reviews": ["README copy reviewed"],
  "user_test_case_gate": {
    "required": true,
    "cases": "verify/user-test-cases.json",
    "signoff": "verify/user-test-case-signoff.json",
    "domain_matrix": "verify/domain-case-matrix.json"
  }
}
JSON
cat >"$VERIFY_DIR/evidence-index.jsonl" <<'JSONL'
{"id":"ev-static","kind":"command","domain":"static","result":"pass"}
{"id":"ev-unit","kind":"command","domain":"unit","result":"pass"}
JSONL
cat >"$VERIFY_DIR/traceability-matrix.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "light-readme-copy",
  "entries": [{
    "changed_file": "README.md",
    "requirement_refs": ["requirements.md"],
    "task_refs": ["tasks.md"],
    "prototype_refs": ["prototype/decision.json"],
    "foundation_spec_refs": ["light-lane:not-required"],
    "verification_domains": ["static", "unit"]
  }],
  "unmapped_changes": []
}
JSON
cat >"$VERIFY_DIR/blocker-classification.jsonl" <<'JSONL'
JSONL
cat >"$VERIFY_DIR/root-cause-checks.jsonl" <<'JSONL'
JSONL
cat >"$VERIFY_DIR/receipt.md" <<'MD'
# Receipt
## Covered Scope
- README.md
## Uncovered Scope
- None
## Residual Risk
- None
## Confidence
- C
MD
cat >"$VERIFY_DIR/receipt.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "light-readme-copy",
  "result": "green",
  "covered_scope": ["README.md"],
  "uncovered_scope": [],
  "residual_risk": [],
  "confidence": "C"
}
JSON
mkdir -p "$VERIFY_DIR/static" "$VERIFY_DIR/unit"
for domain in static unit; do
  cat >"$VERIFY_DIR/$domain/report.md" <<MD
# $domain Report
## Domain
$domain
## Verdict
green
## Inputs Reviewed
- README.md
## Evidence
- ev-$domain
## Commands Run
- true
## Findings
- None
## Required Fixes
- None
## Residual Risk
- None
## Follow-up Domain Routing
- None
MD
  cat >"$VERIFY_DIR/$domain/report.json" <<JSON
{
  "schema_version": 1,
  "domain": "$domain",
  "verdict": "green",
  "required": true,
  "evidence": ["ev-$domain"],
  "commands": ["true"],
  "findings": [],
  "required_fixes": [],
  "residual_risk": [],
  "blocker_class": null
}
JSON
done
mkdir -p "$VERIFY_DIR/unit"
cat >"$VERIFY_DIR/unit/test-quality-rubric.json" <<'JSON'
{
  "schema_version": 1,
  "checks": {
    "public_interface_only": true,
    "edge_cases": true,
    "no_brittle_selectors": true
  },
  "findings": []
}
JSON

set +e
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" \
  node "$VERIFY/scripts/verify-domains.js" validate --json >"$TMP_DIR/light-verify-pending.json"
VERIFY_PENDING_STATUS=$?
set -e
[[ "$VERIFY_PENDING_STATUS" == "2" ]]
jq -e '.blockers | index("verify:user-test-cases-unapproved")' "$TMP_DIR/light-verify-pending.json" >/dev/null

cat >"$VERIFY_DIR/user-test-case-signoff.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "light-readme-copy",
  "status": "approved",
  "user_decision": "Approved the compact light test case for README copy.",
  "approved_case_ids": ["LIGHT-CASE-001"]
}
JSON

python3 - "$CHANGE_DIR/acceptance.json" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
for assertion in data["assertions"]:
    assertion["status"] = "passing"
    assertion["evidence_ref"] = "verify/static/report.json"
json.dump(data, open(path, "w"), indent=2)
open(path, "a").write("\n")
PY
perl -0pi -e 's/- \[ \]/- [x]/g' "$CHANGE_DIR/tasks.md" "$CHANGE_DIR/acceptance.md"
mkdir -p "$CHANGE_DIR/development"
cat >"$CHANGE_DIR/development/validation-log.jsonl" <<'JSONL'
{"status":"pass","attestation":"system-executed","command":"true"}
JSONL

set +e
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" \
  node "$VERIFY/scripts/verify-domains.js" aggregate --json >"$TMP_DIR/light-aggregate.json"
AGGREGATE_STATUS=$?
set -e
if [[ "$AGGREGATE_STATUS" != "0" ]]; then
  echo "light aggregate expected green" >&2
  cat "$TMP_DIR/light-aggregate.json" >&2
  exit 1
fi
jq -e '.verdict == "green" and .lane == "light" and (.required_domains == ["static", "unit"])' "$TMP_DIR/light-aggregate.json" >/dev/null

set +e
PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" \
  node "$OPS/scripts/operations-gate.js" --json >"$TMP_DIR/light-ops.json"
OPS_STATUS=$?
set -e
if [[ "$OPS_STATUS" != "0" ]]; then
  echo "light operations gate expected green" >&2
  cat "$TMP_DIR/light-ops.json" >&2
  exit 1
fi
jq -e '.ok == true and .lane == "light" and .release_target == "local-only"' "$TMP_DIR/light-ops.json" >/dev/null
jq -e '(.artifacts | map(.name) | index("readiness.md")) == null' "$TMP_DIR/light-ops.json" >/dev/null

PROJECT_DIR="$PROJECT" SPECNAV_CHANGE="$CHANGE" \
  node "$OPS/scripts/archive-gate.js" --json >"$TMP_DIR/light-archive.json"
jq -e '.verdict == "green" and .lane == "light"' "$TMP_DIR/light-archive.json" >/dev/null

echo "specnav light compact gate fixtures ok"
