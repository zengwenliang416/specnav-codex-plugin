#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERIFY="$ROOT/plugins/specnav-verification"
POLICY_ASSET="$ROOT/plugins/specnav-requirements/skills/specnav-foundation-specs/assets-optional/ai-annotation-policy/design.md"
SCAN="$VERIFY/scripts/anchor-scan.js"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }

setup_project() {
  local proj="$1"
  mkdir -p "$proj/openspec/changes/demo/verify/static" "$proj/openspec/.specnav" "$proj/src"
  ( cd "$proj" && git init -q && git config user.email t@t && git config user.name t )
  printf 'export function a(){return 1}\n' >"$proj/src/a.js"
  printf '// @ai-anchor FLOW-b: entry seam\nexport function b(){return 2}\n' >"$proj/src/b.js"
  ( cd "$proj" && git add -A && git commit -qm init )
  # touch both files so they appear in the diff vs HEAD
  printf 'export function a(){return 3}\n' >"$proj/src/a.js"
  printf '// @ai-anchor FLOW-b: entry seam\nexport function b(){return 4}\n' >"$proj/src/b.js"
}

# --- Case 1: advisory policy present -> coverage computed, never blocks -------
P1="$TMP_DIR/advisory"
setup_project "$P1"
mkdir -p "$P1/openspec/specs/ai-annotation-policy"
cp "$POLICY_ASSET" "$P1/openspec/specs/ai-annotation-policy/design.md"
OUT="$(PROJECT_DIR="$P1" node "$SCAN" --json)"
echo "$OUT" | jq -e '.enforcement == "advisory" and .coverage_ratio == 0.5 and (.uncovered | index("src/a.js")) != null and .ok == true and (.blockers | length == 0)' >/dev/null \
  || { echo "anchor-scan fixture failed: advisory row"; echo "$OUT"; exit 1; }
test -f "$P1/openspec/changes/demo/verify/static/anchor-report.json" || { echo "anchor-scan fixture failed: report not written"; exit 1; }
grep -q '"type":"anchor.coverage"' "$P1/openspec/.specnav/events.jsonl" || { echo "anchor-scan fixture failed: event not emitted"; exit 1; }

# --- Case 2: gate policy -> uncovered touched file blocks, exit 2 -------------
P2="$TMP_DIR/gate"
setup_project "$P2"
mkdir -p "$P2/openspec/specs/ai-annotation-policy"
sed 's/enforcement: advisory/enforcement: gate/' "$POLICY_ASSET" >"$P2/openspec/specs/ai-annotation-policy/design.md"
set +e
OUT="$(PROJECT_DIR="$P2" node "$SCAN" --json)"
CODE=$?
set -e
[ "$CODE" -eq 2 ] || { echo "anchor-scan fixture failed: gate should exit 2, got $CODE"; exit 1; }
echo "$OUT" | jq -e '.enforcement == "gate" and (.blockers | index("anchor-uncovered:src/a.js")) != null and .ok == false' >/dev/null \
  || { echo "anchor-scan fixture failed: gate row"; echo "$OUT"; exit 1; }

# --- Case 3: no policy -> present:false, ok:true, no blockers -----------------
P3="$TMP_DIR/absent"
setup_project "$P3"
OUT="$(PROJECT_DIR="$P3" node "$SCAN" --json)"
echo "$OUT" | jq -e '.policy_present == false and .enforcement == null and .ok == true and (.blockers | length == 0)' >/dev/null \
  || { echo "anchor-scan fixture failed: absent-policy row"; echo "$OUT"; exit 1; }

echo "specnav anchor-scan fixtures ok"
