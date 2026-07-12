#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/plugins/specnav-core"
PROJECT_FIXTURE="$ROOT/tests/fixtures/simple-project"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

guard() {
  local project="$1" payload="$2" expected="$3" label="$4"
  set +e
  printf '%s' "$payload" | PROJECT_DIR="$project" node "$CORE/scripts/specnav-guard.js" >/tmp/promoted-check.out 2>/tmp/promoted-check.err
  local status=$?
  set -e
  [[ "$status" == "$expected" ]] \
    || { echo "promoted-check guard fixture failed ($label): expected $expected got $status"; cat /tmp/promoted-check.err; exit 1; }
}

write_rule() {
  # $1 project, $2 enforcement
  local project="$1" enforcement="$2"
  mkdir -p "$project/openspec/knowledge/promoted-checks"
  cat >"$project/openspec/knowledge/promoted-checks/pricing-guard.json" <<JSON
{"schema":"specnav.knowledge.promotedCheck.v1","id":"pricing-guard","statement":"edits to pricing UI must recompute totals","verify_via":"guard","enforcement":"$enforcement","deny_globs":["src/ui/**"],"reason":"pricing seam","generalized":true}
JSON
}

EDIT='{"tool_name":"Write","tool_input":{"file_path":"src/ui/theme.ts","content":"x"}}'

# Case 1: no promoted-check rule -> in-scope edit allowed (baseline unchanged).
P="$TMP_DIR/none"
cp -R "$PROJECT_FIXTURE" "$P"
guard "$P" "$EDIT" 0 "no rule baseline"

# Case 2: advisory rule -> NOT enforced by the guard (opt-in only).
P="$TMP_DIR/advisory"
cp -R "$PROJECT_FIXTURE" "$P"
write_rule "$P" advisory
guard "$P" "$EDIT" 0 "advisory not enforced"

# Case 3: gate rule matching an in-scope edit -> denied + audited.
P="$TMP_DIR/gate"
cp -R "$PROJECT_FIXTURE" "$P"
write_rule "$P" gate
guard "$P" "$EDIT" 2 "gate denies"
grep -q '\[promoted-check:pricing-guard\]' /tmp/promoted-check.err \
  || { echo "promoted-check guard fixture failed: deny reason missing blocker id"; cat /tmp/promoted-check.err; exit 1; }
grep -q '"reason":"promoted-check:pricing-guard"' "$P/openspec/.specnav/events.jsonl" \
  || { echo "promoted-check guard fixture failed: no audit event"; exit 1; }

# Case 4: gate rule + override -> allowed and override use audited.
P="$TMP_DIR/override"
cp -R "$PROJECT_FIXTURE" "$P"
write_rule "$P" gate
mkdir -p "$P/openspec/.specnav/overrides"
cat >"$P/openspec/.specnav/overrides/promoted-check.json" <<'JSON'
{"gate":"promoted-check","reason":"reviewed: totals recomputed in this change","active_change":"add-dark-mode","affected_path":"src/ui/theme.ts","expires_at":"2099-01-01T00:00:00.000Z"}
JSON
guard "$P" "$EDIT" 0 "override allows"
grep -q '"gate":"promoted-check"' "$P/openspec/.specnav/events.jsonl" \
  || { echo "promoted-check guard fixture failed: override use not audited"; exit 1; }

echo "specnav promoted-check guard fixtures ok"
