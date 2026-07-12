#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPS="$ROOT/plugins/specnav-operations"
DRYRUN="$OPS/scripts/promotion-dry-run.js"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }

setup_project() {
  local proj="$1"
  mkdir -p "$proj/openspec/changes/demo/operations" "$proj/openspec/.specnav" \
           "$proj/openspec/knowledge/promoted-checks" "$proj/src/pricing"
  ( cd "$proj" && git init -q && git config user.email t@t && git config user.name t )
  printf 'export const price = 1\n' >"$proj/src/pricing/cart.js"
  ( cd "$proj" && git add -A && git commit -qm init )
}

write_check() {
  # $1 project, $2 statement, $3 deny_glob
  local proj="$1" statement="$2" glob="$3"
  cat >"$proj/openspec/knowledge/promoted-checks/cart-total-guard.json" <<JSON
{
  "schema": "specnav.knowledge.promotedCheck.v1",
  "id": "cart-total-guard",
  "statement": "$statement",
  "verify_via": "guard",
  "enforcement": "advisory",
  "deny_globs": ["$glob"],
  "reason": "pricing seam",
  "generalized": true,
  "evidence_ref": "operations/postmortem.md"
}
JSON
  cat >"$proj/openspec/changes/demo/operations/update-spec.json" <<JSON
{
  "schema": "specnav.ops.updateSpec.v1",
  "change": "demo",
  "status": "no_writeback_needed",
  "learning_items": [],
  "unresolved_items": [],
  "promoted_checks": [
    {
      "id": "cart-total-guard",
      "statement": "$statement",
      "verify_via": "guard",
      "candidate_artifact": "openspec/knowledge/promoted-checks/cart-total-guard.json",
      "generalized": true,
      "status": "candidate",
      "evidence_ref": "operations/postmortem.md"
    }
  ]
}
JSON
}

# --- Case 1: generalized candidate + valid rule -> pass -----------------------
P1="$TMP_DIR/pass"
setup_project "$P1"
write_check "$P1" "edits to pricing modules must recompute cart totals" "src/pricing/**"
OUT="$(PROJECT_DIR="$P1" node "$DRYRUN" --id cart-total-guard --json)"
echo "$OUT" | jq -e '.result == "pass" and .generalized == true and .matching_files >= 1 and (.findings | length == 0)' >/dev/null \
  || { echo "promotion dry-run fixture failed: pass case"; echo "$OUT"; exit 1; }
test -f "$P1/openspec/changes/demo/operations/promotion/cart-total-guard/dry-run.json" \
  || { echo "promotion dry-run fixture failed: report not written"; exit 1; }
grep -q '"type":"promotion.dry-run"' "$P1/openspec/.specnav/events.jsonl" \
  || { echo "promotion dry-run fixture failed: event not emitted"; exit 1; }

# --- Case 2: statement names a one-off token -> not generalized, fail ---------
P2="$TMP_DIR/notgeneral"
setup_project "$P2"
write_check "$P2" "order 8842190 double-charged when coupon applied" "src/pricing/**"
OUT="$(PROJECT_DIR="$P2" node "$DRYRUN" --id cart-total-guard --json)"
echo "$OUT" | jq -e '.generalized == false and .result == "fail" and ((.findings | map(startswith("not-generalized")) | any))' >/dev/null \
  || { echo "promotion dry-run fixture failed: not-generalized case"; echo "$OUT"; exit 1; }

# --- Case 3: missing rule file -> findings, still exit 0 ----------------------
P3="$TMP_DIR/missing"
setup_project "$P3"
cat >"$P3/openspec/changes/demo/operations/update-spec.json" <<'JSON'
{"schema":"specnav.ops.updateSpec.v1","change":"demo","status":"no_writeback_needed","learning_items":[],"unresolved_items":[],"promoted_checks":[{"id":"cart-total-guard","statement":"x","verify_via":"guard","candidate_artifact":"openspec/knowledge/promoted-checks/nope.json","generalized":true,"status":"candidate","evidence_ref":"operations/postmortem.md"}]}
JSON
set +e
OUT="$(PROJECT_DIR="$P3" node "$DRYRUN" --id cart-total-guard --json)"
CODE=$?
set -e
[ "$CODE" -eq 0 ] || { echo "promotion dry-run fixture failed: must exit 0 (non-blocking), got $CODE"; exit 1; }
echo "$OUT" | jq -e '.result == "fail" and ((.findings | index("unreadable-rule")) != null)' >/dev/null \
  || { echo "promotion dry-run fixture failed: missing-rule case"; echo "$OUT"; exit 1; }

echo "specnav promotion-dry-run fixtures ok"
